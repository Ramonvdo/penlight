//! Windows.UI.Composition visual tree for the presenter window: spotlight dim
//! layer (radial-gradient hole), cursor halo shape, and click-pulse visuals.
//! Visuals move via Offset/property changes — the window itself never moves.

use windows::core::{h, Interface, Result};
use windows::Foundation::TimeSpan;
use windows_numerics::{Vector2, Vector3};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::Composition::ICompositorDesktopInterop;
use windows::UI::Color;
use windows::UI::Composition::Desktop::DesktopWindowTarget;
use windows::UI::Composition::{
    CompositionRadialGradientBrush, CompositionSpriteShape, Compositor, ContainerVisual,
    ShapeVisual, SpriteVisual,
};

use super::{HaloShape, HaloVisibility, PresenterConfig};

const PULSE_MS: u64 = 380;

fn color(rgb: (u8, u8, u8), alpha: f32) -> Color {
    Color {
        A: (alpha.clamp(0.0, 1.0) * 255.0) as u8,
        R: rgb.0,
        G: rgb.1,
        B: rgb.2,
    }
}

pub struct Tree {
    compositor: Compositor,
    _target: DesktopWindowTarget,
    root: ContainerVisual,
    spot: SpriteVisual,
    spot_brush: CompositionRadialGradientBrush,
    halo: ShapeVisual,
    lens: ShapeVisual,
    pulse_layer: ContainerVisual,
    pulses: Vec<(ShapeVisual, u64)>,
    win_w: f32,
    win_h: f32,
    halo_size: f32,
    lens_size: f32,
    base_opacity: f32,
    pulse_color: (u8, u8, u8),
    spot_radius: f32,
}

impl Tree {
    pub fn new(hwnd: HWND, win_w: f32, win_h: f32) -> Result<Self> {
        let compositor = Compositor::new()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
        let root = compositor.CreateContainerVisual()?;
        root.SetSize(Vector2 { X: win_w, Y: win_h })?;
        target.SetRoot(&root)?;

        // Spotlight: full-window sprite with a radial gradient whose center
        // hole follows the cursor (PowerToys Find My Mouse pattern).
        let spot_brush = compositor.CreateRadialGradientBrush()?;
        spot_brush.SetEllipseCenter(Vector2 { X: 0.5, Y: 0.5 })?;
        let spot = compositor.CreateSpriteVisual()?;
        spot.SetSize(Vector2 { X: win_w, Y: win_h })?;
        spot.SetBrush(&spot_brush)?;
        spot.SetIsVisible(false)?;
        root.Children()?.InsertAtTop(&spot)?;

        let halo = compositor.CreateShapeVisual()?;
        halo.SetIsVisible(false)?;
        root.Children()?.InsertAtTop(&halo)?;

        // Lens chrome: anti-aliased ring + inner rim + glass sheen, floating
        // above the magnifier window (which the presenter is re-raised over).
        let lens = compositor.CreateShapeVisual()?;
        lens.SetIsVisible(false)?;
        root.Children()?.InsertAtTop(&lens)?;

        let pulse_layer = compositor.CreateContainerVisual()?;
        pulse_layer.SetSize(Vector2 { X: win_w, Y: win_h })?;
        root.Children()?.InsertAtTop(&pulse_layer)?;

        Ok(Self {
            compositor,
            _target: target,
            root,
            spot,
            spot_brush,
            halo,
            lens,
            pulse_layer,
            pulses: Vec::new(),
            win_w,
            win_h,
            halo_size: 64.0,
            lens_size: 340.0,
            base_opacity: 0.9,
            pulse_color: (246, 51, 154),
            spot_radius: 160.0,
        })
    }

    /// A sprite shape matching the lens outline (circle or rounded square),
    /// inset from the lens box edge. Corner radius tracks the host window's
    /// CreateRoundRectRgn(w/5) clip, whose corner RADIUS is w/10.
    fn lens_shape(&self, circle: bool, size: f32, inset: f32) -> Result<CompositionSpriteShape> {
        if circle {
            let geometry = self.compositor.CreateEllipseGeometry()?;
            geometry.SetCenter(Vector2 {
                X: size / 2.0,
                Y: size / 2.0,
            })?;
            geometry.SetRadius(Vector2 {
                X: size / 2.0 - inset,
                Y: size / 2.0 - inset,
            })?;
            self.compositor.CreateSpriteShapeWithGeometry(&geometry)
        } else {
            let geometry = self.compositor.CreateRoundedRectangleGeometry()?;
            geometry.SetOffset(Vector2 { X: inset, Y: inset })?;
            geometry.SetSize(Vector2 {
                X: size - inset * 2.0,
                Y: size - inset * 2.0,
            })?;
            let corner = (size * 0.1 - inset * 0.5).max(2.0);
            geometry.SetCornerRadius(Vector2 {
                X: corner,
                Y: corner,
            })?;
            self.compositor.CreateSpriteShapeWithGeometry(&geometry)
        }
    }

    fn rebuild_lens(&mut self, config: &PresenterConfig) -> Result<()> {
        self.lens_size = config.lens_size;
        let shapes = self.lens.Shapes()?;
        shapes.Clear()?;
        if config.lens_active {
            let size = config.lens_size;
            let circle = config.lens_circle;
            let border = config.lens_border_width;

            // Glass sheen: a soft diagonal white gradient across the top —
            // the shape's own fill clips the gradient to the lens outline.
            let sheen_brush = self.compositor.CreateLinearGradientBrush()?;
            sheen_brush.SetStartPoint(Vector2 { X: 0.2, Y: 0.0 })?;
            sheen_brush.SetEndPoint(Vector2 { X: 0.55, Y: 1.0 })?;
            let stops = sheen_brush.ColorStops()?;
            stops.Append(&self.compositor.CreateColorGradientStopWithOffsetAndColor(
                0.0,
                color((255, 255, 255), 0.30),
            )?)?;
            stops.Append(&self.compositor.CreateColorGradientStopWithOffsetAndColor(
                0.32,
                color((255, 255, 255), 0.07),
            )?)?;
            stops.Append(&self.compositor.CreateColorGradientStopWithOffsetAndColor(
                0.55,
                color((255, 255, 255), 0.0),
            )?)?;
            let sheen = self.lens_shape(circle, size, 1.0)?;
            sheen.SetFillBrush(&sheen_brush)?;
            shapes.Append(&sheen)?;

            // Inner rim: a subtle dark line just inside the ring for depth.
            let rim = self.lens_shape(circle, size, border.max(1.0) + 1.5)?;
            rim.SetStrokeBrush(
                &self
                    .compositor
                    .CreateColorBrushWithColor(color((0, 0, 0), 0.22))?,
            )?;
            rim.SetStrokeThickness(1.5)?;
            shapes.Append(&rim)?;

            // Border ring: anti-aliased, slightly overlapping the host
            // window's hard region-clip edge to hide its jagged pixels.
            if border > 0.0 {
                let ring = self.lens_shape(circle, size, (border / 2.0 - 1.0).max(0.0))?;
                ring.SetStrokeBrush(
                    &self
                        .compositor
                        .CreateColorBrushWithColor(color(config.lens_border_color, 1.0))?,
                )?;
                ring.SetStrokeThickness(border + 1.0)?;
                shapes.Append(&ring)?;
            }
            self.lens.SetSize(Vector2 { X: size, Y: size })?;
        }
        self.lens.SetIsVisible(config.lens_active)?;
        Ok(())
    }

    pub fn apply(&mut self, config: &PresenterConfig) -> Result<()> {
        self.halo_size = config.size;
        self.base_opacity = config.opacity;
        self.pulse_color = config.color;
        self.spot_radius = config.spot_radius;

        // Rebuild the halo shape.
        let size = config.size;
        let border = config.border_width;
        let shapes = self.halo.Shapes()?;
        shapes.Clear()?;
        let brush = self
            .compositor
            .CreateColorBrushWithColor(color(config.color, 1.0))?;
        let sprite: CompositionSpriteShape = match config.shape {
            HaloShape::Ring => {
                let geometry = self.compositor.CreateEllipseGeometry()?;
                geometry.SetCenter(Vector2 {
                    X: size / 2.0,
                    Y: size / 2.0,
                })?;
                geometry.SetRadius(Vector2 {
                    X: (size - border) / 2.0,
                    Y: (size - border) / 2.0,
                })?;
                self.compositor.CreateSpriteShapeWithGeometry(&geometry)?
            }
            HaloShape::Squircle => {
                let geometry = self.compositor.CreateRoundedRectangleGeometry()?;
                geometry.SetSize(Vector2 {
                    X: size - border,
                    Y: size - border,
                })?;
                geometry.SetOffset(Vector2 {
                    X: border / 2.0,
                    Y: border / 2.0,
                })?;
                let corner = (size - border) * 0.3;
                geometry.SetCornerRadius(Vector2 {
                    X: corner,
                    Y: corner,
                })?;
                self.compositor.CreateSpriteShapeWithGeometry(&geometry)?
            }
            HaloShape::Rhombus => {
                let side = (size - border) * 0.72;
                let geometry = self.compositor.CreateRoundedRectangleGeometry()?;
                geometry.SetSize(Vector2 { X: side, Y: side })?;
                geometry.SetOffset(Vector2 {
                    X: (size - side) / 2.0,
                    Y: (size - side) / 2.0,
                })?;
                let corner = side * 0.15;
                geometry.SetCornerRadius(Vector2 {
                    X: corner,
                    Y: corner,
                })?;
                self.compositor.CreateSpriteShapeWithGeometry(&geometry)?
            }
        };
        sprite.SetStrokeBrush(&brush)?;
        sprite.SetStrokeThickness(border)?;
        if config.dashed {
            let dashes = sprite.StrokeDashArray()?;
            dashes.Append(2.2)?;
            dashes.Append(1.8)?;
        }
        shapes.Append(&sprite)?;
        self.halo.SetSize(Vector2 { X: size, Y: size })?;
        self.halo.SetCenterPoint(Vector3 {
            X: size / 2.0,
            Y: size / 2.0,
            Z: 0.0,
        })?;
        if config.shape == HaloShape::Rhombus {
            self.halo.SetRotationAngleInDegrees(45.0)?;
        } else {
            self.halo.SetRotationAngleInDegrees(0.0)?;
        }
        self.halo.SetIsVisible(config.halo_on)?;
        self.halo.SetOpacity(match config.visibility {
            HaloVisibility::Clicks => 0.0,
            _ => config.opacity,
        })?;

        // Spotlight gradient: transparent center, soft edge, dim outside.
        let stops = self.spot_brush.ColorStops()?;
        stops.Clear()?;
        let transparent = color(config.spot_color, 0.0);
        let dim = color(config.spot_color, config.spot_dim);
        stops.Append(
            &self
                .compositor
                .CreateColorGradientStopWithOffsetAndColor(0.0, transparent)?,
        )?;
        stops.Append(
            &self
                .compositor
                .CreateColorGradientStopWithOffsetAndColor(0.82, transparent)?,
        )?;
        stops.Append(
            &self
                .compositor
                .CreateColorGradientStopWithOffsetAndColor(1.0, dim)?,
        )?;
        self.spot.SetIsVisible(config.spotlight_on)?;

        self.rebuild_lens(config)?;

        Ok(())
    }

    pub fn set_cursor(&mut self, x: f32, y: f32, scale: f32) -> Result<()> {
        self.lens.SetOffset(Vector3 {
            X: x - self.lens_size / 2.0,
            Y: y - self.lens_size / 2.0,
            Z: 0.0,
        })?;
        self.halo.SetOffset(Vector3 {
            X: x - self.halo_size / 2.0,
            Y: y - self.halo_size / 2.0,
            Z: 0.0,
        })?;
        self.halo.SetScale(Vector3 {
            X: scale,
            Y: scale,
            Z: 1.0,
        })?;
        let r = self.spot_radius * scale;
        self.spot_brush.SetEllipseCenter(Vector2 {
            X: x / self.win_w,
            Y: y / self.win_h,
        })?;
        self.spot_brush.SetEllipseRadius(Vector2 {
            X: r / self.win_w,
            Y: r / self.win_h,
        })?;
        Ok(())
    }

    pub fn pulse(&mut self, left: bool, x: f32, y: f32, scale: f32, now: u64) -> Result<()> {
        let rgb = if left { self.pulse_color } else { (255, 255, 255) };
        let box_size = self.halo_size;
        let geometry = self.compositor.CreateEllipseGeometry()?;
        geometry.SetCenter(Vector2 {
            X: box_size / 2.0,
            Y: box_size / 2.0,
        })?;
        geometry.SetRadius(Vector2 {
            X: box_size / 2.0 - 2.0,
            Y: box_size / 2.0 - 2.0,
        })?;
        let sprite = self.compositor.CreateSpriteShapeWithGeometry(&geometry)?;
        sprite.SetStrokeBrush(&self.compositor.CreateColorBrushWithColor(color(rgb, 1.0))?)?;
        sprite.SetStrokeThickness(3.0)?;
        let visual = self.compositor.CreateShapeVisual()?;
        visual.Shapes()?.Append(&sprite)?;
        visual.SetSize(Vector2 {
            X: box_size,
            Y: box_size,
        })?;
        visual.SetCenterPoint(Vector3 {
            X: box_size / 2.0,
            Y: box_size / 2.0,
            Z: 0.0,
        })?;
        visual.SetOffset(Vector3 {
            X: x - box_size / 2.0,
            Y: y - box_size / 2.0,
            Z: 0.0,
        })?;
        self.pulse_layer.Children()?.InsertAtTop(&visual)?;

        let duration = TimeSpan {
            Duration: (PULSE_MS as i64) * 10_000,
        };
        let grow = self.compositor.CreateVector3KeyFrameAnimation()?;
        grow.InsertKeyFrame(
            0.0,
            Vector3 {
                X: 0.45 * scale,
                Y: 0.45 * scale,
                Z: 1.0,
            },
        )?;
        grow.InsertKeyFrame(
            1.0,
            Vector3 {
                X: 1.55 * scale,
                Y: 1.55 * scale,
                Z: 1.0,
            },
        )?;
        grow.SetDuration(duration)?;
        visual.StartAnimation(h!("Scale"), &grow)?;

        let fade = self.compositor.CreateScalarKeyFrameAnimation()?;
        fade.InsertKeyFrame(0.0, 0.85)?;
        fade.InsertKeyFrame(1.0, 0.0)?;
        fade.SetDuration(duration)?;
        visual.StartAnimation(h!("Opacity"), &fade)?;

        self.pulses.push((visual, now + PULSE_MS + 120));
        Ok(())
    }

    pub fn cleanup_pulses(&mut self, now: u64) {
        if self.pulses.is_empty() {
            return;
        }
        let layer = &self.pulse_layer;
        self.pulses.retain(|(visual, deadline)| {
            if *deadline <= now {
                if let Ok(children) = layer.Children() {
                    let _ = children.Remove(visual);
                }
                false
            } else {
                true
            }
        });
    }

    pub fn animate_halo_opacity(&self, target: f32) -> Result<()> {
        let fade = self.compositor.CreateScalarKeyFrameAnimation()?;
        fade.InsertKeyFrame(1.0, target * self.base_opacity)?;
        fade.SetDuration(TimeSpan {
            Duration: 200 * 10_000,
        })?;
        self.halo.StartAnimation(h!("Opacity"), &fade)?;
        Ok(())
    }

    pub fn resize(&mut self, win_w: f32, win_h: f32) -> Result<()> {
        self.win_w = win_w;
        self.win_h = win_h;
        self.root.SetSize(Vector2 { X: win_w, Y: win_h })?;
        self.spot.SetSize(Vector2 { X: win_w, Y: win_h })?;
        self.pulse_layer.SetSize(Vector2 { X: win_w, Y: win_h })?;
        Ok(())
    }
}

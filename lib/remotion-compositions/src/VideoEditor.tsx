import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  OffthreadVideo,
  Video,
  Img,
  getRemotionEnvironment,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import type { TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { slide } from "@remotion/transitions/slide";

export type TextStyle =
  | "title"
  | "lower-third"
  | "caption"
  | "kinetic"
  | "typewriter"
  | "glitch"
  | "wave"
  | "highlight"
  | "quote"
  | "subtitle"
  | "callout"
  | "end-card";

export type TextAnimation =
  | "spring"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "fade"
  | "zoom"
  | "bounce"
  | "typewriter"
  | "wave"
  | "glitch"
  | "blur"
  | "none";

export type OverlayPosition =
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "top-left"
  | "top-center"
  | "top-right"
  | "left-center"
  | "right-center"
  | "custom";

export interface TextOverlayItem {
  id: string;
  type: "text";
  text: string;
  subtext?: string;
  style: TextStyle;
  animation?: TextAnimation;
  startFrame: number;
  durationFrames: number;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  position: OverlayPosition;
  fontSize?: number;
  customX?: number;
  customY?: number;
  customWidth?: number;
  rotation?: number;
  opacity?: number;
  shadow?: boolean;
  outline?: boolean;
  fullScreen?: boolean;
}

export interface BrollOverlayItem {
  id: string;
  type: "broll";
  src: string;
  mediaType: "image" | "video";
  startFrame: number;
  durationFrames: number;
  opacity: number;
  fit: "cover" | "contain";
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  customWidth?: number;
  customHeight?: number;
}

export interface ZoomPanItem {
  id: string;
  type: "zoom-pan";
  startFrame: number;
  durationFrames: number;
  zoomLevel: number;
  panX: number;
  panY: number;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring";
}

export interface ShapeOverlayItem {
  id: string;
  type: "shape";
  shape: "rectangle" | "circle" | "line" | "arrow" | "bracket" | "underline" | "divider";
  startFrame: number;
  durationFrames: number;
  color: string;
  strokeWidth?: number;
  fill?: boolean;
  position: OverlayPosition;
  customX?: number;
  customY?: number;
  customWidth?: number;
  customHeight?: number;
  animation?: TextAnimation;
  opacity?: number;
}

export interface ProgressBarItem {
  id: string;
  type: "progress-bar";
  startFrame: number;
  durationFrames: number;
  color: string;
  backgroundColor?: string;
  position: "top" | "bottom";
  height?: number;
  label?: string;
}

export interface SocialCardItem {
  id: string;
  type: "social-card";
  platform: "youtube" | "instagram" | "tiktok" | "twitter" | "generic";
  text: string;
  subtext?: string;
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  accentColor: string;
  animation?: TextAnimation;
}

export interface CounterItem {
  id: string;
  type: "counter";
  startValue: number;
  endValue: number;
  prefix?: string;
  suffix?: string;
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  textColor: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface WatermarkItem {
  id: string;
  type: "watermark";
  text?: string;
  imageSrc?: string;
  position: OverlayPosition;
  opacity: number;
  startFrame: number;
  durationFrames: number;
  size?: number;
}

export interface HighlightItem {
  id: string;
  type: "spotlight";
  startFrame: number;
  durationFrames: number;
  spotX: number;
  spotY: number;
  spotRadius: number;
  dimOpacity?: number;
}

export interface SplitScreenItem {
  id: string;
  type: "split-screen";
  startFrame: number;
  durationFrames: number;
  layout: "horizontal" | "vertical";
  secondarySrc: string;
  secondaryMediaType: "image" | "video";
  ratio?: number;
}

export interface TransitionItem {
  id: string;
  type: "transition";
  transitionType: "fade-black" | "fade-white" | "wipe-left" | "wipe-right" | "wipe-up" | "wipe-down" | "zoom-in" | "zoom-out" | "dissolve";
  startFrame: number;
  durationFrames: number;
}

export interface AnimatedListItem {
  id: string;
  type: "animated-list";
  items: string[];
  heading?: string;
  iconType?: "bullet" | "number" | "check" | "arrow" | "dash" | "none";
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  staggerFrames?: number;
}

export interface IconBadgeItem {
  id: string;
  type: "icon-badge";
  icon: string;
  label: string;
  sublabel?: string;
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  badgeStyle?: "circle" | "rounded" | "pill";
}

export interface GradientTextItem {
  id: string;
  type: "gradient-text";
  text: string;
  subtext?: string;
  gradientColors?: string[];
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
}

export interface TextRevealItem {
  id: string;
  type: "text-reveal";
  text: string;
  subtext?: string;
  revealDirection?: "left" | "right" | "up" | "down" | "center";
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  customX?: number;
  customY?: number;
}

export interface ParticleBurstItem {
  id: string;
  type: "particle-burst";
  particleCount?: number;
  particleType?: "confetti" | "sparkle" | "circle" | "square";
  colors?: string[];
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  customX?: number;
  customY?: number;
  spread?: number;
}

export interface BarChartItem {
  id: string;
  type: "bar-chart";
  bars: { label: string; value: number; color?: string }[];
  heading?: string;
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  maxValue?: number;
}

export interface DonutChartItem {
  id: string;
  type: "donut-chart";
  segments: { label: string; value: number; color: string }[];
  centerLabel?: string;
  centerValue?: string;
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  size?: number;
}

export interface IconRowItem {
  id: string;
  type: "icon-row";
  icons: { icon: string; label: string }[];
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  staggerFrames?: number;
}

export interface TextStackItem {
  id: string;
  type: "text-stack";
  lines: { text: string; fontSize?: number; color?: string; weight?: number; letterSpacing?: number }[];
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  gap?: number;
  align?: "left" | "center" | "right";
}

export interface FullTitleItem {
  id: string;
  type: "full-title";
  text: string;
  subtext?: string;
  gradientFrom?: string;
  gradientTo?: string;
  startFrame: number;
  durationFrames: number;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  accentColor: string;
}

export interface FullScreenListItem {
  id: string;
  type: "full-screen-list";
  heading?: string;
  items: string[];
  iconType?: "bullet" | "number" | "check" | "arrow" | "dash" | "none";
  startFrame: number;
  durationFrames: number;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontFamily?: string;
  fontSize?: number;
  animation?: TextAnimation;
}

export interface FullScreenPunchItem {
  id: string;
  type: "full-screen-punch";
  text: string;
  subtext?: string;
  startFrame: number;
  durationFrames: number;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontFamily?: string;
  fontSize?: number;
  animation?: TextAnimation;
}

export interface ScreenFlashItem {
  id: string;
  type: "screen-flash";
  color?: string;
  intensity?: number;
  startFrame: number;
  durationFrames: number;
}

export interface ZoomTextItem {
  id: string;
  type: "zoom-text";
  text: string;
  startFrame: number;
  durationFrames: number;
  position: OverlayPosition;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  accentColor?: string;
  customX?: number;
  customY?: number;
  startScale?: number;
}

export interface ColorWipeItem {
  id: string;
  type: "color-wipe";
  color: string;
  direction?: "left" | "right" | "up" | "down";
  startFrame: number;
  durationFrames: number;
  thickness?: number;
}

export interface CustomCodeItem {
  id: string;
  type: "custom";
  code: string;
  label?: string;
  startFrame: number;
  durationFrames: number;
}

export type OverlayItem =
  | TextOverlayItem
  | BrollOverlayItem
  | ZoomPanItem
  | ShapeOverlayItem
  | ProgressBarItem
  | SocialCardItem
  | CounterItem
  | WatermarkItem
  | HighlightItem
  | SplitScreenItem
  | TransitionItem
  | AnimatedListItem
  | IconBadgeItem
  | GradientTextItem
  | TextRevealItem
  | ParticleBurstItem
  | BarChartItem
  | DonutChartItem
  | IconRowItem
  | TextStackItem
  | FullTitleItem
  | FullScreenListItem
  | FullScreenPunchItem
  | ScreenFlashItem
  | ZoomTextItem
  | ColorWipeItem
  | CustomCodeItem;

export interface VideoEditorProps {
  videoUrl: string;
  overlays: OverlayItem[];
}

function getPositionStyle(position: OverlayPosition, customX?: number, customY?: number): React.CSSProperties {
  const base: React.CSSProperties = { position: "absolute" };
  if (position === "custom" && customX !== undefined && customY !== undefined) {
    return { ...base, left: `${customX}%`, top: `${customY}%`, transform: "translate(-50%, -50%)" };
  }
  const map: Record<string, React.CSSProperties> = {
    "center": { display: "flex", alignItems: "center", justifyContent: "center" },
    "bottom-left": { display: "flex", alignItems: "flex-end", justifyContent: "flex-start", padding: 60 },
    "bottom-center": { display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 60 },
    "bottom-right": { display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 60 },
    "top-left": { display: "flex", alignItems: "flex-start", justifyContent: "flex-start", padding: 60 },
    "top-center": { display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 60 },
    "top-right": { display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 60 },
    "left-center": { display: "flex", alignItems: "center", justifyContent: "flex-start", padding: 60 },
    "right-center": { display: "flex", alignItems: "center", justifyContent: "flex-end", padding: 60 },
  };
  return map[position] || map["center"];
}

function getEnterAnimation(
  animation: TextAnimation | undefined,
  frame: number,
  fps: number,
  durationFrames: number,
): { transform: string; opacity: number; filter?: string } {
  const anim = animation || "spring";
  const exitStart = Math.max(0, durationFrames - 10);
  const exitOpacity = interpolate(frame, [exitStart, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  switch (anim) {
    case "spring": {
      const s = spring({ frame, fps, config: { damping: 14, stiffness: 180 } });
      return { transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)`, opacity: s * exitOpacity };
    }
    case "slide-left": {
      const s = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
      return { transform: `translateX(${interpolate(s, [0, 1], [-100, 0])}px)`, opacity: s * exitOpacity };
    }
    case "slide-right": {
      const s = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
      return { transform: `translateX(${interpolate(s, [0, 1], [100, 0])}px)`, opacity: s * exitOpacity };
    }
    case "slide-up": {
      const s = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
      return { transform: `translateY(${interpolate(s, [0, 1], [80, 0])}px)`, opacity: s * exitOpacity };
    }
    case "slide-down": {
      const s = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });
      return { transform: `translateY(${interpolate(s, [0, 1], [-80, 0])}px)`, opacity: s * exitOpacity };
    }
    case "fade": {
      const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return { transform: "none", opacity: fadeIn * exitOpacity };
    }
    case "zoom": {
      const s = spring({ frame, fps, config: { damping: 12, stiffness: 200 } });
      return { transform: `scale(${interpolate(s, [0, 1], [0.3, 1])})`, opacity: s * exitOpacity };
    }
    case "bounce": {
      const s = spring({ frame, fps, config: { damping: 8, stiffness: 300, mass: 0.6 } });
      return { transform: `translateY(${interpolate(s, [0, 1], [60, 0])}px) scale(${interpolate(s, [0, 1], [0.8, 1])})`, opacity: s * exitOpacity };
    }
    case "blur": {
      const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const blur = interpolate(frame, [0, 20], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return { transform: "none", opacity: fadeIn * exitOpacity, filter: `blur(${blur}px)` };
    }
    case "none":
      return { transform: "none", opacity: exitOpacity };
    default:
      return { transform: "none", opacity: exitOpacity };
  }
}

const TitleOverlay: React.FC<{
  text: string;
  subtext?: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  position: OverlayPosition;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
  shadow?: boolean;
  outline?: boolean;
  customX?: number;
  customY?: number;
  customWidth?: number;
  rotation?: number;
  itemOpacity?: number;
}> = ({ text, subtext, accentColor, backgroundColor, textColor, fontFamily, position, fontSize, durationFrames, animation, shadow, outline, customX, customY, customWidth, rotation, itemOpacity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation, frame, fps, durationFrames);
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 48;

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: (itemOpacity ?? 1) }}>
      <div
        style={{
          backgroundColor: `${backgroundColor}cc`,
          padding: "16px 32px",
          borderRadius: 8,
          borderLeft: `4px solid ${accentColor}`,
          transform: `${anim.transform}${rotation ? ` rotate(${rotation}deg)` : ""}`,
          opacity: anim.opacity,
          filter: anim.filter,
          maxWidth: customWidth ? `${customWidth}%` : "80%",
          boxShadow: shadow ? "0 8px 32px rgba(0,0,0,0.5)" : undefined,
        }}
      >
        <div
          style={{
            fontFamily,
            fontSize: size,
            fontWeight: 900,
            color: textColor,
            textTransform: "uppercase",
            lineHeight: 1.2,
            textShadow: outline ? `2px 2px 0 ${accentColor}, -2px -2px 0 ${accentColor}, 2px -2px 0 ${accentColor}, -2px 2px 0 ${accentColor}` : undefined,
          }}
        >
          {text}
        </div>
        {subtext && (
          <div
            style={{
              fontFamily,
              fontSize: size * 0.5,
              color: textColor,
              opacity: 0.7,
              marginTop: 8,
              letterSpacing: 2,
            }}
          >
            {subtext}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

const LowerThirdOverlay: React.FC<{
  text: string;
  subtext?: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  position: OverlayPosition;
  durationFrames: number;
  animation?: TextAnimation;
}> = ({ text, subtext, accentColor, backgroundColor, textColor, fontFamily, position, durationFrames, animation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({ frame, fps, config: { damping: 15, stiffness: 120 } });
  const exitS = interpolate(frame, [durationFrames - 12, durationFrames], [0, -120], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [durationFrames - 12, durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const justify = position === "bottom-right" ? "flex-end" : position === "bottom-center" ? "center" : "flex-start";
  const xOffset = interpolate(slideIn, [0, 1], [position === "bottom-right" ? 100 : -100, 0]);

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: justify,
          padding: "0 60px",
          opacity: fadeOut,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            transform: `translateX(${xOffset + exitS}px)`,
          }}
        >
          <div style={{ backgroundColor: accentColor, padding: "10px 28px", borderRadius: "4px 4px 0 0" }}>
            <span style={{ fontFamily, fontSize: 28, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: 2 }}>
              {text}
            </span>
          </div>
          {subtext && (
            <div
              style={{
                backgroundColor: `${backgroundColor}dd`,
                padding: "6px 28px",
                borderRadius: "0 0 4px 4px",
                transform: `scaleX(${slideIn})`,
                transformOrigin: position === "bottom-right" ? "right" : "left",
              }}
            >
              <span style={{ fontFamily, fontSize: 18, color: textColor, letterSpacing: 3, textTransform: "uppercase", opacity: slideIn }}>
                {subtext}
              </span>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CaptionOverlay: React.FC<{
  text: string;
  accentColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
}> = ({ text, accentColor, textColor, fontFamily, fontSize, durationFrames, animation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation || "spring", frame, fps, durationFrames);
  const size = fontSize || 36;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 80px 100px",
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0,0,0,0.75)",
          padding: "12px 24px",
          borderRadius: 6,
          transform: anim.transform,
          opacity: anim.opacity,
          filter: anim.filter,
          textAlign: "center",
          borderBottom: `3px solid ${accentColor}`,
        }}
      >
        <span
          style={{
            fontFamily,
            fontSize: size,
            fontWeight: 700,
            color: textColor,
            lineHeight: 1.4,
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};

const KineticOverlay: React.FC<{
  text: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  durationFrames: number;
}> = ({ text, accentColor, backgroundColor, textColor, fontFamily, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: `${backgroundColor}dd`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        opacity: fadeOut,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 16 }}>
        {words.map((word, i) => {
          const delay = i * 4;
          const s = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 200, mass: 0.5 } });
          return (
            <span
              key={i}
              style={{
                fontFamily,
                fontSize: 64,
                fontWeight: 900,
                color: i % 3 === 0 ? accentColor : textColor,
                transform: `translateY(${interpolate(s, [0, 1], [50, 0])}px)`,
                opacity: s,
                textTransform: "uppercase",
                letterSpacing: -1,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const TypewriterOverlay: React.FC<{
  text: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  position: OverlayPosition;
  durationFrames: number;
  customX?: number;
  customY?: number;
}> = ({ text, accentColor, backgroundColor, textColor, fontFamily, fontSize, position, durationFrames, customX, customY }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 40;
  const charsPerFrame = text.length / Math.max(1, durationFrames * 0.6);
  const visibleChars = Math.min(text.length, Math.floor(frame * charsPerFrame));
  const showCursor = frame % Math.floor(fps * 0.5) < Math.floor(fps * 0.25);
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div
        style={{
          backgroundColor: `${backgroundColor}cc`,
          padding: "16px 32px",
          borderRadius: 8,
          borderLeft: `4px solid ${accentColor}`,
          maxWidth: "80%",
        }}
      >
        <span style={{ fontFamily, fontSize: size, fontWeight: 700, color: textColor, letterSpacing: 1 }}>
          {text.slice(0, visibleChars)}
        </span>
        {visibleChars < text.length && showCursor && (
          <span style={{ fontFamily, fontSize: size, fontWeight: 700, color: accentColor }}>|</span>
        )}
      </div>
    </AbsoluteFill>
  );
};

const GlitchOverlay: React.FC<{
  text: string;
  accentColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
}> = ({ text, accentColor, textColor, fontFamily, fontSize, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = fontSize || 64;
  const s = spring({ frame, fps, config: { damping: 10, stiffness: 300 } });
  const fadeOut = interpolate(frame, [durationFrames - 8, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const glitchPhase = frame < 10;
  const offsetX = glitchPhase ? Math.sin(frame * 7) * 6 : 0;
  const offsetY = glitchPhase ? Math.cos(frame * 11) * 4 : 0;

  return (
    <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", opacity: fadeOut }}>
      <div style={{ position: "relative" }}>
        <div
          style={{
            fontFamily, fontSize: size, fontWeight: 900, color: "cyan", textTransform: "uppercase",
            position: "absolute", left: glitchPhase ? -3 : 0, top: glitchPhase ? 2 : 0,
            opacity: glitchPhase ? 0.7 : 0, clipPath: glitchPhase ? `inset(${20 + frame * 3}% 0 ${30 - frame * 2}% 0)` : undefined,
          }}
        >
          {text}
        </div>
        <div
          style={{
            fontFamily, fontSize: size, fontWeight: 900, color: accentColor, textTransform: "uppercase",
            position: "absolute", left: glitchPhase ? 3 : 0, top: glitchPhase ? -2 : 0,
            opacity: glitchPhase ? 0.7 : 0, clipPath: glitchPhase ? `inset(${40 - frame * 2}% 0 ${10 + frame * 3}% 0)` : undefined,
          }}
        >
          {text}
        </div>
        <div
          style={{
            fontFamily, fontSize: size, fontWeight: 900, color: textColor, textTransform: "uppercase",
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${interpolate(s, [0, 1], [1.2, 1])})`,
            opacity: s,
            textShadow: glitchPhase ? `2px 0 ${accentColor}, -2px 0 cyan` : "none",
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const WaveOverlay: React.FC<{
  text: string;
  accentColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
}> = ({ text, accentColor, textColor, fontFamily, fontSize, durationFrames }) => {
  const frame = useCurrentFrame();
  const size = fontSize || 56;
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const chars = text.split("");

  return (
    <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", opacity: fadeOut }}>
      <div style={{ display: "flex" }}>
        {chars.map((char, i) => {
          const wave = Math.sin((frame - i * 3) * 0.15) * 12;
          const enterDelay = i * 2;
          const charOpacity = interpolate(frame - enterDelay, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <span
              key={i}
              style={{
                fontFamily, fontSize: size, fontWeight: 900,
                color: i % 4 === 0 ? accentColor : textColor,
                transform: `translateY(${wave}px)`,
                opacity: charOpacity,
                display: "inline-block",
                textTransform: "uppercase",
              }}
            >
              {char === " " ? "\u00A0" : char}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const HighlightTextOverlay: React.FC<{
  text: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  position: OverlayPosition;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
}> = ({ text, accentColor, backgroundColor, textColor, fontFamily, fontSize, position, durationFrames, animation, customX, customY }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation || "spring", frame, fps, durationFrames);
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 42;
  const highlightWidth = interpolate(frame, [0, 15], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={posStyle}>
      <div style={{ position: "relative", transform: anim.transform, opacity: anim.opacity, filter: anim.filter }}>
        <div
          style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(90deg, ${accentColor}66 ${highlightWidth}%, transparent ${highlightWidth}%)`,
            borderRadius: 4, padding: "8px 20px",
          }}
        />
        <div style={{ position: "relative", padding: "8px 20px" }}>
          <span style={{ fontFamily, fontSize: size, fontWeight: 800, color: textColor, textTransform: "uppercase" }}>
            {text}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const QuoteOverlay: React.FC<{
  text: string;
  subtext?: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
}> = ({ text, subtext, accentColor, backgroundColor, textColor, fontFamily, fontSize, durationFrames, animation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation || "fade", frame, fps, durationFrames);
  const size = fontSize || 40;

  return (
    <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          maxWidth: "75%", backgroundColor: `${backgroundColor}dd`, padding: "40px 48px", borderRadius: 12,
          borderLeft: `6px solid ${accentColor}`, transform: anim.transform, opacity: anim.opacity, filter: anim.filter,
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ fontFamily, fontSize: size * 1.5, color: accentColor, lineHeight: 0.5, marginBottom: 16 }}>"</div>
        <div style={{ fontFamily, fontSize: size, fontWeight: 600, color: textColor, lineHeight: 1.5, fontStyle: "italic" }}>
          {text}
        </div>
        {subtext && (
          <div style={{ fontFamily, fontSize: size * 0.5, color: textColor, opacity: 0.6, marginTop: 16, letterSpacing: 2, textTransform: "uppercase" }}>
            -- {subtext}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

const SubtitleOverlay: React.FC<{
  text: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  outline?: boolean;
  accentColor: string;
}> = ({ text, textColor, fontFamily, fontSize, durationFrames, outline, accentColor }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationFrames - 5, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = fontSize || 32;

  return (
    <AbsoluteFill style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 40px 60px" }}>
      <div
        style={{
          backgroundColor: "rgba(0,0,0,0.6)", padding: "8px 20px", borderRadius: 4,
          opacity: fadeIn * fadeOut, textAlign: "center",
        }}
      >
        <span
          style={{
            fontFamily, fontSize: size, fontWeight: 600, color: textColor, lineHeight: 1.4,
            textShadow: outline ? `1px 1px 2px ${accentColor}, -1px -1px 2px ${accentColor}` : "1px 1px 3px rgba(0,0,0,0.8)",
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};

const CalloutOverlay: React.FC<{
  text: string;
  subtext?: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  position: OverlayPosition;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
}> = ({ text, subtext, accentColor, backgroundColor, textColor, fontFamily, fontSize, position, durationFrames, animation, customX, customY }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation || "zoom", frame, fps, durationFrames);
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 28;

  return (
    <AbsoluteFill style={posStyle}>
      <div
        style={{
          backgroundColor: accentColor, padding: "14px 28px", borderRadius: 24,
          transform: anim.transform, opacity: anim.opacity, filter: anim.filter,
          boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
        }}
      >
        <span style={{ fontFamily, fontSize: size, fontWeight: 800, color: "#fff", textTransform: "uppercase" }}>
          {text}
        </span>
        {subtext && (
          <span style={{ fontFamily, fontSize: size * 0.7, color: "#ffffffcc", marginLeft: 12 }}>
            {subtext}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

const EndCardOverlay: React.FC<{
  text: string;
  subtext?: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
}> = ({ text, subtext, accentColor, backgroundColor, textColor, fontFamily, fontSize, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
  const fadeOut = interpolate(frame, [durationFrames - 15, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = fontSize || 56;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: `${backgroundColor}f0`, display: "flex", alignItems: "center",
        justifyContent: "center", flexDirection: "column", gap: 20, opacity: fadeOut,
      }}
    >
      <div
        style={{
          fontFamily, fontSize: size, fontWeight: 900, color: textColor,
          textTransform: "uppercase", letterSpacing: 4, transform: `scale(${interpolate(s, [0, 1], [0.5, 1])})`, opacity: s,
        }}
      >
        {text}
      </div>
      {subtext && (
        <div style={{ fontFamily, fontSize: size * 0.4, color: accentColor, letterSpacing: 6, textTransform: "uppercase", opacity: s }}>
          {subtext}
        </div>
      )}
      <div style={{ width: 60, height: 3, backgroundColor: accentColor, borderRadius: 2, transform: `scaleX(${s})`, marginTop: 8 }} />
    </AbsoluteFill>
  );
};

const BrollOverlay: React.FC<{
  src: string;
  mediaType: "image" | "video";
  opacity: number;
  fit: "cover" | "contain";
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  customWidth?: number;
  customHeight?: number;
}> = ({ src, mediaType, opacity, fit, durationFrames, animation, customX, customY, customWidth, customHeight }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation || "fade", frame, fps, durationFrames);
  const isCustom = customX !== undefined && customY !== undefined;
  const env = getRemotionEnvironment();
  const VideoComponent = env.isRendering ? OffthreadVideo : Video;

  const containerStyle: React.CSSProperties = isCustom
    ? {
        position: "absolute",
        left: `${customX}%`,
        top: `${customY}%`,
        width: customWidth ? `${customWidth}%` : "40%",
        height: customHeight ? `${customHeight}%` : "40%",
        transform: `translate(-50%, -50%) ${anim.transform}`,
        opacity: opacity * anim.opacity,
        filter: anim.filter,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      }
    : {
        opacity: opacity * anim.opacity,
        transform: anim.transform,
        filter: anim.filter,
      };

  if (isCustom) {
    return (
      <div style={containerStyle}>
        {mediaType === "video" ? (
          <VideoComponent src={src} style={{ width: "100%", height: "100%", objectFit: fit }} muted />
        ) : (
          <Img src={src} style={{ width: "100%", height: "100%", objectFit: fit }} />
        )}
      </div>
    );
  }

  return (
    <AbsoluteFill style={containerStyle}>
      {mediaType === "video" ? (
        <VideoComponent src={src} style={{ width: "100%", height: "100%", objectFit: fit }} muted />
      ) : (
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: fit }} />
      )}
    </AbsoluteFill>
  );
};

const ZoomPanOverlay: React.FC<{
  zoomLevel: number;
  panX: number;
  panY: number;
  durationFrames: number;
  easing?: string;
}> = ({ zoomLevel, panX, panY, durationFrames, easing }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let progress: number;

  if (easing === "spring") {
    progress = spring({ frame, fps, config: { damping: 20, stiffness: 80 }, durationInFrames: durationFrames });
  } else {
    progress = interpolate(frame, [0, durationFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (easing === "ease-in") progress = progress * progress;
    else if (easing === "ease-out") progress = 1 - (1 - progress) * (1 - progress);
    else if (easing === "ease-in-out") progress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  }

  const currentZoom = interpolate(progress, [0, 1], [1, zoomLevel]);
  const currentPanX = interpolate(progress, [0, 1], [0, panX]);
  const currentPanY = interpolate(progress, [0, 1], [0, panY]);

  return (
    <AbsoluteFill
      style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        transform: `scale(${currentZoom}) translate(${currentPanX}%, ${currentPanY}%)`,
        transformOrigin: "center center",
      }}
    />
  );
};

const ShapeOverlayComponent: React.FC<{
  shape: string;
  color: string;
  strokeWidth?: number;
  fill?: boolean;
  position: OverlayPosition;
  customX?: number;
  customY?: number;
  customWidth?: number;
  customHeight?: number;
  durationFrames: number;
  animation?: TextAnimation;
  itemOpacity?: number;
}> = ({ shape, color, strokeWidth, fill, position, customX, customY, customWidth, customHeight, durationFrames, animation, itemOpacity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation || "fade", frame, fps, durationFrames);
  const posStyle = getPositionStyle(position, customX, customY);
  const sw = strokeWidth || 3;
  const w = customWidth || 20;
  const h = customHeight || 20;

  const shapeEl = (() => {
    switch (shape) {
      case "circle":
        return (
          <svg width={`${w}%`} viewBox="0 0 100 100" style={{ maxWidth: 200, maxHeight: 200 }}>
            <circle cx="50" cy="50" r="46" stroke={color} strokeWidth={sw} fill={fill ? color : "none"} opacity={fill ? 0.3 : 1} />
          </svg>
        );
      case "rectangle":
        return (
          <svg width={`${w}%`} viewBox="0 0 160 90" style={{ maxWidth: 320, maxHeight: 180 }}>
            <rect x={sw} y={sw} width={160 - sw * 2} height={90 - sw * 2} rx="6" stroke={color} strokeWidth={sw} fill={fill ? `${color}33` : "none"} />
          </svg>
        );
      case "divider":
        return (
          <div style={{ width: `${w}%`, maxWidth: 400 }}>
            <div style={{ height: sw, backgroundColor: color, borderRadius: sw, transform: `scaleX(${interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})` }} />
          </div>
        );
      case "underline":
        return (
          <div style={{ width: `${w}%`, maxWidth: 300 }}>
            <div style={{ height: sw + 1, backgroundColor: color, borderRadius: sw, transform: `scaleX(${interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})`, transformOrigin: "left" }} />
          </div>
        );
      case "arrow":
        return (
          <svg width={`${w}%`} viewBox="0 0 100 40" style={{ maxWidth: 200 }}>
            <line x1="5" y1="20" x2="80" y2="20" stroke={color} strokeWidth={sw} />
            <polygon points="80,10 95,20 80,30" fill={color} />
          </svg>
        );
      case "bracket":
        return (
          <svg width={`${w * 0.3}%`} viewBox="0 0 30 100" style={{ maxWidth: 30, maxHeight: 200 }}>
            <path d="M25,5 L10,5 L10,95 L25,95" stroke={color} strokeWidth={sw} fill="none" />
          </svg>
        );
      default:
        return (
          <div style={{ width: `${w}%`, height: sw, backgroundColor: color, borderRadius: sw }} />
        );
    }
  })();

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: (itemOpacity ?? 1) * anim.opacity }}>
      <div style={{ transform: anim.transform, filter: anim.filter }}>
        {shapeEl}
      </div>
    </AbsoluteFill>
  );
};

const ProgressBarOverlay: React.FC<{
  color: string;
  bgColor?: string;
  position: "top" | "bottom";
  height?: number;
  label?: string;
  durationFrames: number;
}> = ({ color, bgColor, position, height, label, durationFrames }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationFrames], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const h = height || 6;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute", left: 0, right: 0,
          [position === "top" ? "top" : "bottom"]: 0,
          height: h, backgroundColor: bgColor || "rgba(255,255,255,0.15)",
        }}
      >
        <div
          style={{
            height: "100%", width: `${progress}%`, backgroundColor: color,
            borderRadius: position === "bottom" ? `${h}px ${h}px 0 0` : `0 0 ${h}px ${h}px`,
            transition: "width 0.05s linear",
          }}
        />
      </div>
      {label && (
        <div
          style={{
            position: "absolute", [position === "top" ? "top" : "bottom"]: h + 8,
            right: 20, fontSize: 14, color: "rgba(255,255,255,0.7)", fontFamily: "Inter, sans-serif",
            letterSpacing: 2, textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      )}
    </AbsoluteFill>
  );
};

const SocialCardOverlay: React.FC<{
  platform: string;
  text: string;
  subtext?: string;
  position: OverlayPosition;
  accentColor: string;
  durationFrames: number;
  animation?: TextAnimation;
}> = ({ platform, text, subtext, position, accentColor, durationFrames, animation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = getEnterAnimation(animation || "slide-up", frame, fps, durationFrames);
  const posStyle = getPositionStyle(position);

  const platformColors: Record<string, string> = {
    youtube: "#FF0000",
    instagram: "#E4405F",
    tiktok: "#000000",
    twitter: "#1DA1F2",
    generic: accentColor,
  };
  const pColor = platformColors[platform] || accentColor;
  const platformLabels: Record<string, string> = {
    youtube: "YOUTUBE",
    instagram: "INSTAGRAM",
    tiktok: "TIKTOK",
    twitter: "X / TWITTER",
    generic: "",
  };

  return (
    <AbsoluteFill style={posStyle}>
      <div
        style={{
          backgroundColor: "rgba(0,0,0,0.9)", padding: "16px 28px", borderRadius: 12,
          borderLeft: `4px solid ${pColor}`, transform: anim.transform, opacity: anim.opacity,
          filter: anim.filter, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", maxWidth: "60%",
        }}
      >
        {platformLabels[platform] && (
          <div style={{ fontSize: 11, color: pColor, fontWeight: 700, letterSpacing: 3, marginBottom: 6, fontFamily: "Inter, sans-serif" }}>
            {platformLabels[platform]}
          </div>
        )}
        <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", fontFamily: "Inter, sans-serif" }}>{text}</div>
        {subtext && <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 4, fontFamily: "Inter, sans-serif" }}>{subtext}</div>}
      </div>
    </AbsoluteFill>
  );
};

const CounterOverlay: React.FC<{
  startValue: number;
  endValue: number;
  prefix?: string;
  suffix?: string;
  position: OverlayPosition;
  textColor: string;
  fontSize?: number;
  fontFamily?: string;
  durationFrames: number;
}> = ({ startValue, endValue, prefix, suffix, position, textColor, fontSize, fontFamily, durationFrames }) => {
  const frame = useCurrentFrame();
  const posStyle = getPositionStyle(position);
  const progress = interpolate(frame, [0, durationFrames * 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const eased = 1 - Math.pow(1 - progress, 3);
  const current = Math.round(interpolate(eased, [0, 1], [startValue, endValue]));
  const size = fontSize || 72;
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div style={{ fontFamily: fontFamily || "Inter, sans-serif", fontSize: size, fontWeight: 900, color: textColor, letterSpacing: -2 }}>
        {prefix || ""}{current.toLocaleString()}{suffix || ""}
      </div>
    </AbsoluteFill>
  );
};

const WatermarkOverlay: React.FC<{
  text?: string;
  imageSrc?: string;
  position: OverlayPosition;
  opacity: number;
  size?: number;
}> = ({ text, imageSrc, position, opacity, size }) => {
  const posStyle = getPositionStyle(position);
  const s = size || 24;

  return (
    <AbsoluteFill style={{ ...posStyle, opacity, pointerEvents: "none" }}>
      {imageSrc ? (
        <Img src={imageSrc} style={{ width: s * 4, height: "auto", objectFit: "contain" }} />
      ) : (
        <div style={{ fontFamily: "Inter, sans-serif", fontSize: s, fontWeight: 600, color: "#fff", letterSpacing: 3, textTransform: "uppercase" }}>
          {text || ""}
        </div>
      )}
    </AbsoluteFill>
  );
};

const SpotlightOverlay: React.FC<{
  spotX: number;
  spotY: number;
  spotRadius: number;
  dimOpacity?: number;
  durationFrames: number;
}> = ({ spotX, spotY, spotRadius, dimOpacity, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 16, stiffness: 100 } });
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const r = spotRadius * s;
  const dim = dimOpacity ?? 0.6;

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <div
        style={{
          width: "100%", height: "100%",
          background: `radial-gradient(circle ${r}px at ${spotX}% ${spotY}%, transparent 0%, transparent 100%, rgba(0,0,0,${dim}) 100%)`,
          maskImage: `radial-gradient(circle ${r}px at ${spotX}% ${spotY}%, transparent ${r - 2}px, black ${r}px)`,
          WebkitMaskImage: `radial-gradient(circle ${r}px at ${spotX}% ${spotY}%, transparent ${r - 2}px, black ${r}px)`,
          backgroundColor: `rgba(0,0,0,${dim})`,
        }}
      />
    </AbsoluteFill>
  );
};

const DipToColorPresentation: React.FC<{
  children: React.ReactNode;
  presentationDirection: "entering" | "exiting";
  presentationProgress: number;
  passedProps: { color: string };
}> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const isEntering = presentationDirection === "entering";
  const opacity = isEntering ? presentationProgress : 1 - presentationProgress;
  return (
    <AbsoluteFill style={{ backgroundColor: passedProps.color }}>
      <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const ZoomPresentation: React.FC<{
  children: React.ReactNode;
  presentationDirection: "entering" | "exiting";
  presentationProgress: number;
  passedProps: { zoomIn: boolean };
}> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const isEntering = presentationDirection === "entering";
  const zoomIn = passedProps.zoomIn;
  let scale: number;
  let opacity: number;
  if (zoomIn) {
    scale = isEntering
      ? interpolate(presentationProgress, [0, 1], [3, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : interpolate(presentationProgress, [0, 1], [1, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  } else {
    scale = isEntering
      ? interpolate(presentationProgress, [0, 1], [0.3, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : interpolate(presentationProgress, [0, 1], [1, 0.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }
  opacity = isEntering ? presentationProgress : 1 - presentationProgress;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

function getTransitionPresentation(
  transitionType: TransitionItem["transitionType"],
): TransitionPresentation<Record<string, unknown>> {
  switch (transitionType) {
    case "fade-black":
      return { component: DipToColorPresentation, props: { color: "#000" } } as unknown as TransitionPresentation<Record<string, unknown>>;
    case "fade-white":
      return { component: DipToColorPresentation, props: { color: "#fff" } } as unknown as TransitionPresentation<Record<string, unknown>>;
    case "dissolve":
      return fade() as unknown as TransitionPresentation<Record<string, unknown>>;
    case "wipe-left":
      return wipe({ direction: "from-left" }) as unknown as TransitionPresentation<Record<string, unknown>>;
    case "wipe-right":
      return wipe({ direction: "from-right" }) as unknown as TransitionPresentation<Record<string, unknown>>;
    case "wipe-up":
      return wipe({ direction: "from-top" }) as unknown as TransitionPresentation<Record<string, unknown>>;
    case "wipe-down":
      return wipe({ direction: "from-bottom" }) as unknown as TransitionPresentation<Record<string, unknown>>;
    case "zoom-in":
      return { component: ZoomPresentation, props: { zoomIn: true } } as unknown as TransitionPresentation<Record<string, unknown>>;
    case "zoom-out":
      return { component: ZoomPresentation, props: { zoomIn: false } } as unknown as TransitionPresentation<Record<string, unknown>>;
    default:
      return fade() as unknown as TransitionPresentation<Record<string, unknown>>;
  }
}

const AnimatedListOverlay: React.FC<{
  items: string[];
  heading?: string;
  iconType?: string;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  staggerFrames?: number;
}> = ({ items, heading, iconType, position, accentColor, backgroundColor, textColor, fontFamily, fontSize, durationFrames, animation, customX, customY, staggerFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 28;
  const stagger = staggerFrames || 8;
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const containerAnim = getEnterAnimation(animation || "slide-up", frame, fps, durationFrames);

  const getIcon = (index: number) => {
    const t = iconType || "check";
    switch (t) {
      case "number": return `${index + 1}`;
      case "check": return "\u2713";
      case "arrow": return "\u2192";
      case "dash": return "\u2014";
      case "bullet": return "\u2022";
      case "none": return "";
      default: return "\u2713";
    }
  };

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div
        style={{
          backgroundColor: `${backgroundColor}ee`,
          padding: heading ? "28px 36px 32px" : "24px 36px",
          borderRadius: 16,
          transform: containerAnim.transform,
          opacity: containerAnim.opacity,
          filter: containerAnim.filter,
          maxWidth: "70%",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          borderLeft: `5px solid ${accentColor}`,
        }}
      >
        {heading && (() => {
          const headingSpring = spring({ frame, fps, config: { damping: 14, stiffness: 180 } });
          return (
            <div
              style={{
                fontFamily,
                fontSize: size * 1.3,
                fontWeight: 900,
                color: accentColor,
                textTransform: "uppercase",
                letterSpacing: 2,
                marginBottom: 20,
                paddingBottom: 14,
                borderBottom: `2px solid ${accentColor}33`,
                opacity: headingSpring,
                transform: `translateX(${interpolate(headingSpring, [0, 1], [-20, 0])}px)`,
              }}
            >
              {heading}
            </div>
          );
        })()}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(items || []).map((item, i) => {
            const delay = (heading ? 6 : 0) + i * stagger;
            const s = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 200, mass: 0.5 } });
            const icon = getIcon(i);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity: s,
                  transform: `translateX(${interpolate(s, [0, 1], [40, 0])}px)`,
                }}
              >
                {icon && (
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: iconType === "number" ? 8 : 18,
                      backgroundColor: accentColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily,
                        fontSize: iconType === "number" ? 18 : 20,
                        fontWeight: 800,
                        color: "#fff",
                      }}
                    >
                      {icon}
                    </span>
                  </div>
                )}
                <span
                  style={{
                    fontFamily,
                    fontSize: size,
                    fontWeight: 700,
                    color: textColor,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {item}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const IconBadgeOverlay: React.FC<{
  icon: string;
  label: string;
  sublabel?: string;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  badgeStyle?: string;
}> = ({ icon, label, sublabel, position, accentColor, backgroundColor, textColor, fontFamily, fontSize, durationFrames, animation, customX, customY, badgeStyle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 32;
  const anim = getEnterAnimation(animation || "zoom", frame, fps, durationFrames);
  const style = badgeStyle || "circle";

  const iconSpring = spring({ frame: frame - 3, fps, config: { damping: 10, stiffness: 250, mass: 0.6 } });
  const textSpring = spring({ frame: frame - 8, fps, config: { damping: 14, stiffness: 180 } });
  const pulseScale = 1 + Math.sin(frame * 0.08) * 0.03;

  const badgeRadius = style === "circle" ? "50%" : style === "pill" ? "40px" : "16px";
  const badgeSize = style === "pill" ? { width: "auto", minWidth: 80, height: 80, padding: "0 24px" } : { width: 90, height: 90 };

  return (
    <AbsoluteFill style={{ ...posStyle }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          transform: anim.transform,
          opacity: anim.opacity,
          filter: anim.filter,
        }}
      >
        <div
          style={{
            ...badgeSize,
            borderRadius: badgeRadius,
            backgroundColor: accentColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 8px 30px ${accentColor}66`,
            transform: `scale(${interpolate(iconSpring, [0, 1], [0, 1]) * pulseScale})`,
            opacity: iconSpring,
          }}
        >
          <span
            style={{
              fontSize: 44,
              lineHeight: 1,
            }}
          >
            {icon}
          </span>
        </div>
        <div
          style={{
            backgroundColor: `${backgroundColor}dd`,
            padding: "10px 24px",
            borderRadius: 10,
            textAlign: "center",
            opacity: textSpring,
            transform: `translateY(${interpolate(textSpring, [0, 1], [10, 0])}px)`,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              fontFamily,
              fontSize: size,
              fontWeight: 800,
              color: textColor,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {label}
          </div>
          {sublabel && (
            <div
              style={{
                fontFamily,
                fontSize: size * 0.6,
                color: `${textColor}99`,
                marginTop: 4,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              {sublabel}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const GradientTextOverlay: React.FC<{
  text: string;
  subtext?: string;
  gradientColors?: string[];
  position: OverlayPosition;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
}> = ({ text, subtext, gradientColors, position, textColor, fontFamily, fontSize, durationFrames, animation, customX, customY }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 64;
  const anim = getEnterAnimation(animation || "spring", frame, fps, durationFrames);

  const colors = gradientColors && gradientColors.length >= 2
    ? gradientColors
    : ["#E32652", "#FF6B35", "#FFD700"];

  const sweepProgress = interpolate(frame, [0, 40], [-100, 200], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const words = text.split(" ");

  return (
    <AbsoluteFill style={posStyle}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          transform: anim.transform,
          opacity: anim.opacity,
          filter: anim.filter,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 16 }}>
          {words.map((word, i) => {
            const delay = i * 3;
            const ws = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 200, mass: 0.5 } });
            return (
              <span
                key={i}
                style={{
                  fontFamily,
                  fontSize: size,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: -1,
                  opacity: ws,
                  transform: `translateY(${interpolate(ws, [0, 1], [30, 0])}px)`,
                  backgroundImage: `linear-gradient(90deg, ${colors.join(", ")})`,
                  backgroundSize: "200% 100%",
                  backgroundPosition: `${sweepProgress}% 0`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  textShadow: "none",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
        {subtext && (() => {
          const subtextSpring = spring({ frame: frame - words.length * 3 - 5, fps, config: { damping: 16, stiffness: 140 } });
          return (
            <div
              style={{
                fontFamily,
                fontSize: size * 0.35,
                fontWeight: 600,
                color: textColor,
                textTransform: "uppercase",
                letterSpacing: 4,
                opacity: subtextSpring,
                transform: `translateY(${interpolate(subtextSpring, [0, 1], [15, 0])}px)`,
              }}
            >
              {subtext}
            </div>
          );
        })()}
      </div>
    </AbsoluteFill>
  );
};

class DynamicErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback || null;
    return this.props.children;
  }
}

const DynamicCodeOverlay: React.FC<{
  code: string;
  durationFrames: number;
}> = ({ code, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const rendered = React.useMemo(() => {
    try {
      const renderFn = new Function(
        "React",
        "frame",
        "fps",
        "width",
        "height",
        "durationFrames",
        "interpolate",
        "spring",
        "AbsoluteFill",
        code
      );
      return renderFn(
        React,
        frame,
        fps,
        width,
        height,
        durationFrames,
        interpolate,
        spring,
        AbsoluteFill
      );
    } catch (e) {
      return null;
    }
  }, [code, frame, fps, width, height, durationFrames]);

  return (
    <DynamicErrorBoundary>
      {rendered}
    </DynamicErrorBoundary>
  );
};

const TextRevealOverlay: React.FC<{
  text: string;
  subtext?: string;
  revealDirection?: string;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  customX?: number;
  customY?: number;
}> = ({ text, subtext, revealDirection, position, accentColor, backgroundColor, textColor, fontFamily, fontSize, durationFrames, customX, customY }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 56;
  const dir = revealDirection || "left";
  const revealProgress = interpolate(frame, [0, 20], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const clipMap: Record<string, string> = {
    left: `inset(0 ${100 - revealProgress}% 0 0)`,
    right: `inset(0 0 0 ${100 - revealProgress}%)`,
    up: `inset(${100 - revealProgress}% 0 0 0)`,
    down: `inset(0 0 ${100 - revealProgress}% 0)`,
    center: `inset(${50 - revealProgress / 2}% ${50 - revealProgress / 2}% ${50 - revealProgress / 2}% ${50 - revealProgress / 2}%)`,
  };

  const barWidth = interpolate(frame, [0, 12, 20, 25], [0, 100, 100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const barMap: Record<string, React.CSSProperties> = {
    left: { left: 0, top: 0, width: `${barWidth}%`, height: "100%" },
    right: { right: 0, top: 0, width: `${barWidth}%`, height: "100%" },
    up: { left: 0, top: 0, width: "100%", height: `${barWidth}%` },
    down: { left: 0, bottom: 0, width: "100%", height: `${barWidth}%` },
    center: { left: "25%", top: "25%", width: `${barWidth / 2}%`, height: `${barWidth / 2}%` },
  };

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div style={{ position: "relative", maxWidth: "80%" }}>
        <div style={{ position: "absolute", ...barMap[dir], backgroundColor: accentColor, zIndex: 1 }} />
        <div style={{ clipPath: clipMap[dir], padding: "20px 36px", backgroundColor: `${backgroundColor}dd`, borderRadius: 8 }}>
          <div style={{ fontFamily, fontSize: size, fontWeight: 900, color: textColor, textTransform: "uppercase", letterSpacing: 2, lineHeight: 1.2 }}>
            {text}
          </div>
          {subtext && (
            <div style={{ fontFamily, fontSize: size * 0.4, color: `${textColor}88`, marginTop: 10, letterSpacing: 4, textTransform: "uppercase" }}>
              {subtext}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ParticleBurstOverlay: React.FC<{
  particleCount?: number;
  particleType?: string;
  colors?: string[];
  position: OverlayPosition;
  customX?: number;
  customY?: number;
  spread?: number;
  durationFrames: number;
}> = ({ particleCount, particleType, colors, position, customX, customY, spread, durationFrames }) => {
  const frame = useCurrentFrame();
  const count = particleCount || 30;
  const type = particleType || "confetti";
  const palette = colors && colors.length > 0 ? colors : ["#E32652", "#FFD700", "#00D4FF", "#FF6B35", "#7B2FBE"];
  const sp = spread || 400;

  const particles = React.useMemo(() => {
    const seed = 42;
    return Array.from({ length: count }, (_, i) => {
      const hash = Math.sin(seed + i * 127.1) * 43758.5453;
      const r = hash - Math.floor(hash);
      const hash2 = Math.sin(seed + i * 269.5) * 43758.5453;
      const r2 = hash2 - Math.floor(hash2);
      const hash3 = Math.sin(seed + i * 419.2) * 43758.5453;
      const r3 = hash3 - Math.floor(hash3);
      return {
        angle: r * Math.PI * 2,
        speed: 0.5 + r2 * 1.5,
        rotation: r3 * 360,
        color: palette[i % palette.length],
        size: type === "sparkle" ? 4 + r * 6 : 8 + r * 12,
        delay: Math.floor(r2 * 5),
      };
    });
  }, [count, type, palette]);

  const posStyle = getPositionStyle(position, customX, customY);

  return (
    <AbsoluteFill style={posStyle}>
      <div style={{ position: "relative", width: sp * 2, height: sp * 2 }}>
        {particles.map((p, i) => {
          const t = Math.max(0, frame - p.delay);
          const dist = t * p.speed * 8;
          const x = Math.cos(p.angle) * dist;
          const y = Math.sin(p.angle) * dist - t * 0.3;
          const opacity = interpolate(t, [0, 5, durationFrames * 0.7, durationFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const rot = p.rotation + t * 5;
          const scale = interpolate(t, [0, 8, durationFrames], [0, 1, 0.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

          const shapeStyle: React.CSSProperties = {
            position: "absolute",
            left: sp + x,
            top: sp + y,
            width: p.size,
            height: type === "confetti" ? p.size * 0.4 : p.size,
            backgroundColor: p.color,
            borderRadius: type === "circle" || type === "sparkle" ? "50%" : type === "confetti" ? 2 : 0,
            transform: `rotate(${rot}deg) scale(${scale})`,
            opacity,
            boxShadow: type === "sparkle" ? `0 0 ${p.size}px ${p.color}` : undefined,
          };

          return <div key={i} style={shapeStyle} />;
        })}
      </div>
    </AbsoluteFill>
  );
};

const BarChartOverlay: React.FC<{
  bars: { label: string; value: number; color?: string }[];
  heading?: string;
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  maxValue?: number;
}> = ({ bars, heading, position, accentColor, backgroundColor, textColor, fontFamily, fontSize, durationFrames, animation, customX, customY, maxValue }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 16;
  const containerAnim = getEnterAnimation(animation || "slide-up", frame, fps, durationFrames);
  const safeMax = maxValue || Math.max(...(bars || []).map(b => b.value), 1);
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div style={{
        backgroundColor: `${backgroundColor}ee`, padding: "28px 36px", borderRadius: 16,
        transform: containerAnim.transform, opacity: containerAnim.opacity, filter: containerAnim.filter,
        maxWidth: "65%", boxShadow: "0 12px 40px rgba(0,0,0,0.5)", minWidth: 350,
      }}>
        {heading && (
          <div style={{ fontFamily, fontSize: size * 1.4, fontWeight: 900, color: accentColor, textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, paddingBottom: 12, borderBottom: `2px solid ${accentColor}33` }}>
            {heading}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {(bars || []).map((bar, i) => {
            const delay = (heading ? 8 : 0) + i * 6;
            const barSpring = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120 } });
            const barWidth = (bar.value / safeMax) * 100 * barSpring;
            const barColor = bar.color || accentColor;
            return (
              <div key={i} style={{ opacity: barSpring }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontFamily, fontSize: size, fontWeight: 700, color: textColor, textTransform: "uppercase", letterSpacing: 1 }}>{bar.label}</span>
                  <span style={{ fontFamily, fontSize: size, fontWeight: 800, color: barColor }}>{Math.round(bar.value * barSpring)}</span>
                </div>
                <div style={{ width: "100%", height: 8, backgroundColor: `${textColor}15`, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${barWidth}%`, height: "100%", backgroundColor: barColor, borderRadius: 4, boxShadow: `0 0 10px ${barColor}66` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DonutChartOverlay: React.FC<{
  segments: { label: string; value: number; color: string }[];
  centerLabel?: string;
  centerValue?: string;
  position: OverlayPosition;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  chartSize?: number;
}> = ({ segments, centerLabel, centerValue, position, backgroundColor, textColor, fontFamily, fontSize, durationFrames, animation, customX, customY, chartSize }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = chartSize || 200;
  const containerAnim = getEnterAnimation(animation || "zoom", frame, fps, durationFrames);
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const total = (segments || []).reduce((s, seg) => s + seg.value, 0) || 1;
  const drawProgress = interpolate(frame, [5, 35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const radius = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = size * 0.18;
  const innerR = radius - strokeWidth / 2;

  let accumulated = 0;
  const arcs = (segments || []).map((seg) => {
    const startAngle = (accumulated / total) * 360 - 90;
    const segAngle = (seg.value / total) * 360 * drawProgress;
    accumulated += seg.value;
    const endAngle = startAngle + segAngle;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const largeArc = segAngle > 180 ? 1 : 0;
    const x1 = cx + innerR * Math.cos(startRad);
    const y1 = cy + innerR * Math.sin(startRad);
    const x2 = cx + innerR * Math.cos(endRad);
    const y2 = cy + innerR * Math.sin(endRad);
    return { d: segAngle > 0.1 ? `M ${x1} ${y1} A ${innerR} ${innerR} 0 ${largeArc} 1 ${x2} ${y2}` : "", color: seg.color, label: seg.label };
  });

  const labelSpring = spring({ frame: frame - 30, fps, config: { damping: 14, stiffness: 120 } });

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        backgroundColor: `${backgroundColor}dd`, padding: 32, borderRadius: 20,
        transform: containerAnim.transform, opacity: containerAnim.opacity, filter: containerAnim.filter,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ position: "relative", width: size, height: size }}>
          <svg width={size} height={size} style={{ transform: "rotate(-0.25turn)" }}>
            {arcs.map((arc, i) => arc.d ? (
              <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={strokeWidth} strokeLinecap="round" />
            ) : null)}
          </svg>
          {(centerValue || centerLabel) && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: labelSpring }}>
              {centerValue && <div style={{ fontFamily, fontSize: (fontSize || 36), fontWeight: 900, color: textColor }}>{centerValue}</div>}
              {centerLabel && <div style={{ fontFamily, fontSize: (fontSize || 36) * 0.4, color: `${textColor}88`, textTransform: "uppercase", letterSpacing: 2 }}>{centerLabel}</div>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", opacity: labelSpring }}>
          {(segments || []).map((seg, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: seg.color }} />
              <span style={{ fontFamily, fontSize: (fontSize || 36) * 0.35, color: `${textColor}cc`, textTransform: "uppercase", letterSpacing: 1 }}>{seg.label}</span>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const IconRowOverlay: React.FC<{
  icons: { icon: string; label: string }[];
  position: OverlayPosition;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  staggerFrames?: number;
}> = ({ icons, position, accentColor, backgroundColor, textColor, fontFamily, fontSize, durationFrames, animation, customX, customY, staggerFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 14;
  const stagger = staggerFrames || 6;
  const containerAnim = getEnterAnimation(animation || "slide-up", frame, fps, durationFrames);
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div style={{
        display: "flex", gap: 24, transform: containerAnim.transform, opacity: containerAnim.opacity, filter: containerAnim.filter,
        backgroundColor: `${backgroundColor}dd`, padding: "20px 32px", borderRadius: 16,
        boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
      }}>
        {(icons || []).map((item, i) => {
          const delay = i * stagger;
          const s = spring({ frame: frame - delay, fps, config: { damping: 10, stiffness: 220, mass: 0.5 } });
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, opacity: s, transform: `scale(${interpolate(s, [0, 1], [0.5, 1])}) translateY(${interpolate(s, [0, 1], [20, 0])}px)` }}>
              <div style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: accentColor, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 14px ${accentColor}44` }}>
                <span style={{ fontSize: 26, lineHeight: 1 }}>{item.icon}</span>
              </div>
              <span style={{ fontFamily, fontSize: size, fontWeight: 700, color: textColor, textTransform: "uppercase", letterSpacing: 1, textAlign: "center", maxWidth: 80 }}>{item.label}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const TextStackOverlay: React.FC<{
  lines: { text: string; fontSize?: number; color?: string; weight?: number; letterSpacing?: number }[];
  position: OverlayPosition;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  durationFrames: number;
  animation?: TextAnimation;
  customX?: number;
  customY?: number;
  gap?: number;
  align?: string;
}> = ({ lines, position, backgroundColor, textColor, fontFamily, durationFrames, animation, customX, customY, gap, align }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const containerAnim = getEnterAnimation(animation || "fade", frame, fps, durationFrames);
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const alignment = align || "center";

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div style={{
        display: "flex", flexDirection: "column", gap: gap || 8, alignItems: alignment === "center" ? "center" : alignment === "right" ? "flex-end" : "flex-start",
        backgroundColor: backgroundColor !== "transparent" ? `${backgroundColor}cc` : undefined,
        padding: backgroundColor !== "transparent" ? "28px 40px" : undefined,
        borderRadius: 12,
        transform: containerAnim.transform, opacity: containerAnim.opacity, filter: containerAnim.filter,
        boxShadow: backgroundColor !== "transparent" ? "0 8px 32px rgba(0,0,0,0.4)" : undefined,
      }}>
        {(lines || []).map((line, i) => {
          const delay = i * 4;
          const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 180 } });
          return (
            <div key={i} style={{
              fontFamily, fontSize: line.fontSize || 32, fontWeight: line.weight || 700,
              color: line.color || textColor, letterSpacing: line.letterSpacing || 0,
              textTransform: "uppercase", lineHeight: 1.2,
              opacity: s, transform: `translateY(${interpolate(s, [0, 1], [15, 0])}px)`,
            }}>
              {line.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const FullTitleOverlay: React.FC<{
  text: string;
  subtext?: string;
  gradientFrom?: string;
  gradientTo?: string;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  accentColor: string;
  durationFrames: number;
}> = ({ text, subtext, gradientFrom, gradientTo, textColor, fontFamily, fontSize, accentColor, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = fontSize || 80;
  const from = gradientFrom || "#0a0a0a";
  const to = gradientTo || "#1a1a2e";
  const bgOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationFrames - 15, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const textSpring = spring({ frame: frame - 5, fps, config: { damping: 12, stiffness: 100 } });
  const lineSpring = spring({ frame: frame - 15, fps, config: { damping: 16, stiffness: 140 } });
  const subtextSpring = spring({ frame: frame - 20, fps, config: { damping: 16, stiffness: 140 } });

  const gradientAngle = interpolate(frame, [0, durationFrames], [135, 225], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AbsoluteFill style={{ background: `linear-gradient(${gradientAngle}deg, ${from}, ${to})`, opacity: bgOpacity }} />
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <div style={{
          fontFamily, fontSize: size, fontWeight: 900, color: textColor, textTransform: "uppercase",
          letterSpacing: 6, textAlign: "center", lineHeight: 1.1, maxWidth: "80%",
          opacity: textSpring, transform: `scale(${interpolate(textSpring, [0, 1], [0.8, 1])})`,
        }}>
          {text}
        </div>
        <div style={{ width: 80, height: 4, backgroundColor: accentColor, borderRadius: 2, transform: `scaleX(${lineSpring})`, boxShadow: `0 0 20px ${accentColor}66` }} />
        {subtext && (
          <div style={{
            fontFamily, fontSize: size * 0.3, color: `${textColor}99`, textTransform: "uppercase",
            letterSpacing: 8, opacity: subtextSpring, transform: `translateY(${interpolate(subtextSpring, [0, 1], [10, 0])}px)`,
          }}>
            {subtext}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const FullScreenListOverlay: React.FC<{
  heading?: string;
  items: string[];
  iconType?: string;
  durationFrames: number;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontFamily?: string;
  fontSize?: number;
  animation?: TextAnimation;
}> = ({ heading, items, iconType, durationFrames, backgroundColor, textColor, accentColor, fontFamily, fontSize, animation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = backgroundColor || "#0d0d0d";
  const tc = textColor || "#ffffff";
  const ac = accentColor || "#E32652";
  const ff = fontFamily || "Oswald, sans-serif";
  const fs = fontSize || 36;

  function getIcon(type: string | undefined, idx: number) {
    if (type === "number") return `${idx + 1}.`;
    if (type === "check") return "✓";
    if (type === "arrow") return "→";
    if (type === "dash") return "—";
    if (type === "none") return "";
    return "•";
  }

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: bg }} />
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", padding: "80px 120px" }}>
        {heading && (
          <div style={{ fontFamily: ff, fontSize: fs * 1.1, fontWeight: 900, color: ac, textTransform: "uppercase", letterSpacing: 3, marginBottom: 32, borderBottom: `3px solid ${ac}`, paddingBottom: 16, width: "100%" }}>
            {heading}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%" }}>
          {items.map((item, i) => {
            const delay = i * 5;
            const itemAnim = getEnterAnimation(animation || "slide-up", frame - delay, fps, durationFrames);
            return (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 20,
                  transform: itemAnim.transform,
                  opacity: itemAnim.opacity * (frame >= delay ? 1 : 0),
                }}
              >
                <span style={{ fontFamily: ff, fontSize: fs * 0.9, color: ac, fontWeight: 900, minWidth: 32 }}>
                  {getIcon(iconType, i)}
                </span>
                <span style={{ fontFamily: ff, fontSize: fs, fontWeight: 600, color: tc, lineHeight: 1.3 }}>
                  {item}
                </span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const FullScreenPunchOverlay: React.FC<{
  text: string;
  subtext?: string;
  durationFrames: number;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontFamily?: string;
  fontSize?: number;
  animation?: TextAnimation;
}> = ({ text, subtext, durationFrames, backgroundColor, textColor, accentColor, fontFamily, fontSize, animation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ac = accentColor || "#E32652";
  const tc = textColor || "#ffffff";
  // Full-screen-punch always uses solid black background — no brand tint, no glow
  const bg = "#000000";
  const ff = fontFamily || "Oswald, sans-serif";
  const fs = fontSize || 88;

  const textAnim = getEnterAnimation(animation || "spring", frame, fps, durationFrames);
  const lineSpring = spring({ frame: frame - 8, fps, config: { damping: 16, stiffness: 140 } });
  const subtextAnim = getEnterAnimation("slide-up", frame - 15, fps, durationFrames);

  return (
    <AbsoluteFill>
      {/* Solid black background — no brand tint, no glow */}
      <AbsoluteFill style={{ backgroundColor: bg }} />
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, padding: 80 }}>
        <div style={{
          fontFamily: ff, fontSize: fs, fontWeight: 900, color: tc,
          textTransform: "uppercase", letterSpacing: 4, textAlign: "center",
          lineHeight: 1.05, maxWidth: "85%",
          transform: textAnim.transform, opacity: textAnim.opacity, filter: textAnim.filter,
          textShadow: `0 0 60px ${ac}44`,
        }}>
          {text}
        </div>
        <div style={{
          width: 100, height: 5, backgroundColor: ac, borderRadius: 3,
          transform: `scaleX(${lineSpring})`,
          boxShadow: `0 0 24px ${ac}88, 0 0 48px ${ac}44`,
        }} />
        {subtext && (
          <div style={{
            fontFamily: ff, fontSize: fs * 0.28, color: `${tc}bb`,
            textTransform: "uppercase", letterSpacing: 8, textAlign: "center",
            transform: subtextAnim.transform, opacity: subtextAnim.opacity,
          }}>
            {subtext}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const ScreenFlashOverlay: React.FC<{
  color?: string;
  intensity?: number;
  durationFrames: number;
}> = ({ color, intensity, durationFrames }) => {
  const frame = useCurrentFrame();
  const c = color || "#ffffff";
  const peak = intensity || 0.9;
  const mid = Math.floor(durationFrames / 3);
  const opacity = frame <= mid
    ? interpolate(frame, [0, mid], [0, peak], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : interpolate(frame, [mid, durationFrames], [peak, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return <AbsoluteFill style={{ backgroundColor: c, opacity }} />;
};

const ZoomTextOverlay: React.FC<{
  text: string;
  position: OverlayPosition;
  textColor: string;
  fontFamily: string;
  fontSize?: number;
  accentColor?: string;
  durationFrames: number;
  customX?: number;
  customY?: number;
  startScale?: number;
}> = ({ text, position, textColor, fontFamily, fontSize, accentColor, durationFrames, customX, customY, startScale }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const posStyle = getPositionStyle(position, customX, customY);
  const size = fontSize || 72;
  const initialScale = startScale || 5;
  const fadeOut = interpolate(frame, [durationFrames - 8, durationFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scaleSpring = spring({ frame, fps, config: { damping: 15, stiffness: 80 } });
  const currentScale = interpolate(scaleSpring, [0, 1], [initialScale, 1]);
  const blur = interpolate(scaleSpring, [0, 0.5, 1], [8, 2, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ ...posStyle, opacity: fadeOut }}>
      <div style={{
        fontFamily, fontSize: size, fontWeight: 900, color: textColor, textTransform: "uppercase",
        letterSpacing: 4, transform: `scale(${currentScale})`, filter: `blur(${blur}px)`,
        opacity: scaleSpring, textShadow: accentColor ? `0 0 40px ${accentColor}66` : undefined,
        textAlign: "center",
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

const ColorWipeOverlay: React.FC<{
  color: string;
  direction?: string;
  durationFrames: number;
  thickness?: number;
}> = ({ color, direction, durationFrames, thickness }) => {
  const frame = useCurrentFrame();
  const dir = direction || "right";
  const thick = thickness || 100;
  const progress = interpolate(frame, [0, durationFrames], [-thick, 100 + thick], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const style: React.CSSProperties = (() => {
    switch (dir) {
      case "left": return { position: "absolute" as const, right: `${progress - thick}%`, top: 0, width: `${thick}%`, height: "100%", backgroundColor: color };
      case "right": return { position: "absolute" as const, left: `${progress - thick}%`, top: 0, width: `${thick}%`, height: "100%", backgroundColor: color };
      case "up": return { position: "absolute" as const, left: 0, bottom: `${progress - thick}%`, width: "100%", height: `${thick}%`, backgroundColor: color };
      case "down": return { position: "absolute" as const, left: 0, top: `${progress - thick}%`, width: "100%", height: `${thick}%`, backgroundColor: color };
      default: return { position: "absolute" as const, left: `${progress - thick}%`, top: 0, width: `${thick}%`, height: "100%", backgroundColor: color };
    }
  })();

  return (
    <AbsoluteFill>
      <div style={{ ...style, background: `linear-gradient(${dir === "left" || dir === "right" ? "90deg" : "180deg"}, transparent, ${color}, transparent)` }} />
    </AbsoluteFill>
  );
};

const VideoSceneContent: React.FC<{ videoUrl: string; videoStartFrame: number }> = ({ videoUrl, videoStartFrame }) => {
  const env = getRemotionEnvironment();
  const VideoComponent = env.isRendering ? OffthreadVideo : Video;
  return (
    <AbsoluteFill>
      <Sequence from={-videoStartFrame}>
        <VideoComponent src={videoUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </Sequence>
    </AbsoluteFill>
  );
};

function renderNonTransitionOverlay(overlay: OverlayItem) {
  if (overlay.type === "text") {
    const t = overlay as TextOverlayItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        {t.style === "lower-third" ? (
          <LowerThirdOverlay text={t.text} subtext={t.subtext} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} position={t.position} durationFrames={t.durationFrames} animation={t.animation} />
        ) : t.style === "caption" ? (
          <CaptionOverlay text={t.text} accentColor={t.accentColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} durationFrames={t.durationFrames} animation={t.animation} />
        ) : t.style === "kinetic" ? (
          <KineticOverlay text={t.text} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} durationFrames={t.durationFrames} />
        ) : t.style === "typewriter" ? (
          <TypewriterOverlay text={t.text} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} position={t.position} durationFrames={t.durationFrames} customX={t.customX} customY={t.customY} />
        ) : t.style === "glitch" ? (
          <GlitchOverlay text={t.text} accentColor={t.accentColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} durationFrames={t.durationFrames} />
        ) : t.style === "wave" ? (
          <WaveOverlay text={t.text} accentColor={t.accentColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} durationFrames={t.durationFrames} />
        ) : t.style === "highlight" ? (
          <HighlightTextOverlay text={t.text} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} position={t.position} durationFrames={t.durationFrames} animation={t.animation} customX={t.customX} customY={t.customY} />
        ) : t.style === "quote" ? (
          <QuoteOverlay text={t.text} subtext={t.subtext} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} durationFrames={t.durationFrames} animation={t.animation} />
        ) : t.style === "subtitle" ? (
          <SubtitleOverlay text={t.text} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} durationFrames={t.durationFrames} outline={t.outline} accentColor={t.accentColor} />
        ) : t.style === "callout" ? (
          <CalloutOverlay text={t.text} subtext={t.subtext} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} position={t.position} durationFrames={t.durationFrames} animation={t.animation} customX={t.customX} customY={t.customY} />
        ) : t.style === "end-card" ? (
          <EndCardOverlay text={t.text} subtext={t.subtext} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} fontSize={t.fontSize} durationFrames={t.durationFrames} />
        ) : (
          <TitleOverlay text={t.text} subtext={t.subtext} accentColor={t.accentColor} backgroundColor={t.backgroundColor} textColor={t.textColor} fontFamily={t.fontFamily} position={t.position} fontSize={t.fontSize} durationFrames={t.durationFrames} animation={t.animation} shadow={t.shadow} outline={t.outline} customX={t.customX} customY={t.customY} customWidth={t.customWidth} rotation={t.rotation} itemOpacity={t.opacity} />
        )}
      </Sequence>
    );
  }

  if (overlay.type === "broll") {
    const b = overlay as BrollOverlayItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <BrollOverlay src={b.src} mediaType={b.mediaType} opacity={b.opacity} fit={b.fit} durationFrames={b.durationFrames} animation={b.animation} customX={b.customX} customY={b.customY} customWidth={b.customWidth} customHeight={b.customHeight} />
      </Sequence>
    );
  }

  if (overlay.type === "shape") {
    const s = overlay as ShapeOverlayItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <ShapeOverlayComponent shape={s.shape} color={s.color} strokeWidth={s.strokeWidth} fill={s.fill} position={s.position} customX={s.customX} customY={s.customY} customWidth={s.customWidth} customHeight={s.customHeight} durationFrames={s.durationFrames} animation={s.animation} itemOpacity={s.opacity} />
      </Sequence>
    );
  }

  if (overlay.type === "progress-bar") {
    const p = overlay as ProgressBarItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <ProgressBarOverlay color={p.color} bgColor={p.backgroundColor} position={p.position} height={p.height} label={p.label} durationFrames={p.durationFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "social-card") {
    const sc = overlay as SocialCardItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <SocialCardOverlay platform={sc.platform} text={sc.text} subtext={sc.subtext} position={sc.position} accentColor={sc.accentColor} durationFrames={sc.durationFrames} animation={sc.animation} />
      </Sequence>
    );
  }

  if (overlay.type === "counter") {
    const c = overlay as CounterItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <CounterOverlay startValue={c.startValue} endValue={c.endValue} prefix={c.prefix} suffix={c.suffix} position={c.position} textColor={c.textColor} fontSize={c.fontSize} fontFamily={c.fontFamily} durationFrames={c.durationFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "watermark") {
    const w = overlay as WatermarkItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <WatermarkOverlay text={w.text} imageSrc={w.imageSrc} position={w.position} opacity={w.opacity} size={w.size} />
      </Sequence>
    );
  }

  if (overlay.type === "spotlight") {
    const h = overlay as HighlightItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <SpotlightOverlay spotX={h.spotX} spotY={h.spotY} spotRadius={h.spotRadius} dimOpacity={h.dimOpacity} durationFrames={h.durationFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "animated-list") {
    const al = overlay as AnimatedListItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <AnimatedListOverlay items={al.items} heading={al.heading} iconType={al.iconType} position={al.position} accentColor={al.accentColor} backgroundColor={al.backgroundColor} textColor={al.textColor} fontFamily={al.fontFamily} fontSize={al.fontSize} durationFrames={al.durationFrames} animation={al.animation} customX={al.customX} customY={al.customY} staggerFrames={al.staggerFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "icon-badge") {
    const ib = overlay as IconBadgeItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <IconBadgeOverlay icon={ib.icon} label={ib.label} sublabel={ib.sublabel} position={ib.position} accentColor={ib.accentColor} backgroundColor={ib.backgroundColor} textColor={ib.textColor} fontFamily={ib.fontFamily} fontSize={ib.fontSize} durationFrames={ib.durationFrames} animation={ib.animation} customX={ib.customX} customY={ib.customY} badgeStyle={ib.badgeStyle} />
      </Sequence>
    );
  }

  if (overlay.type === "gradient-text") {
    const gt = overlay as GradientTextItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <GradientTextOverlay text={gt.text} subtext={gt.subtext} gradientColors={gt.gradientColors} position={gt.position} textColor={gt.textColor} fontFamily={gt.fontFamily} fontSize={gt.fontSize} durationFrames={gt.durationFrames} animation={gt.animation} customX={gt.customX} customY={gt.customY} />
      </Sequence>
    );
  }

  if (overlay.type === "text-reveal") {
    const tr = overlay as TextRevealItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <TextRevealOverlay text={tr.text} subtext={tr.subtext} revealDirection={tr.revealDirection} position={tr.position} accentColor={tr.accentColor} backgroundColor={tr.backgroundColor} textColor={tr.textColor} fontFamily={tr.fontFamily} fontSize={tr.fontSize} durationFrames={tr.durationFrames} customX={tr.customX} customY={tr.customY} />
      </Sequence>
    );
  }

  if (overlay.type === "particle-burst") {
    const pb = overlay as ParticleBurstItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <ParticleBurstOverlay particleCount={pb.particleCount} particleType={pb.particleType} colors={pb.colors} position={pb.position} customX={pb.customX} customY={pb.customY} spread={pb.spread} durationFrames={pb.durationFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "bar-chart") {
    const bc = overlay as BarChartItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <BarChartOverlay bars={bc.bars} heading={bc.heading} position={bc.position} accentColor={bc.accentColor} backgroundColor={bc.backgroundColor} textColor={bc.textColor} fontFamily={bc.fontFamily} fontSize={bc.fontSize} durationFrames={bc.durationFrames} animation={bc.animation} customX={bc.customX} customY={bc.customY} maxValue={bc.maxValue} />
      </Sequence>
    );
  }

  if (overlay.type === "donut-chart") {
    const dc = overlay as DonutChartItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <DonutChartOverlay segments={dc.segments} centerLabel={dc.centerLabel} centerValue={dc.centerValue} position={dc.position} backgroundColor={dc.backgroundColor} textColor={dc.textColor} fontFamily={dc.fontFamily} fontSize={dc.fontSize} durationFrames={dc.durationFrames} animation={dc.animation} customX={dc.customX} customY={dc.customY} chartSize={dc.size} />
      </Sequence>
    );
  }

  if (overlay.type === "icon-row") {
    const ir = overlay as IconRowItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <IconRowOverlay icons={ir.icons} position={ir.position} accentColor={ir.accentColor} backgroundColor={ir.backgroundColor} textColor={ir.textColor} fontFamily={ir.fontFamily} fontSize={ir.fontSize} durationFrames={ir.durationFrames} animation={ir.animation} customX={ir.customX} customY={ir.customY} staggerFrames={ir.staggerFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "text-stack") {
    const ts = overlay as TextStackItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <TextStackOverlay lines={ts.lines} position={ts.position} backgroundColor={ts.backgroundColor} textColor={ts.textColor} fontFamily={ts.fontFamily} durationFrames={ts.durationFrames} animation={ts.animation} customX={ts.customX} customY={ts.customY} gap={ts.gap} align={ts.align} />
      </Sequence>
    );
  }

  if (overlay.type === "full-title") {
    const ft = overlay as FullTitleItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <FullTitleOverlay text={ft.text} subtext={ft.subtext} gradientFrom={ft.gradientFrom} gradientTo={ft.gradientTo} textColor={ft.textColor} fontFamily={ft.fontFamily} fontSize={ft.fontSize} accentColor={ft.accentColor} durationFrames={ft.durationFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "full-screen-list") {
    const fsl = overlay as FullScreenListItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <FullScreenListOverlay heading={fsl.heading} items={fsl.items} iconType={fsl.iconType} durationFrames={fsl.durationFrames} backgroundColor={fsl.backgroundColor} textColor={fsl.textColor} accentColor={fsl.accentColor} fontFamily={fsl.fontFamily} fontSize={fsl.fontSize} animation={fsl.animation} />
      </Sequence>
    );
  }

  if (overlay.type === "full-screen-punch") {
    const fsp = overlay as FullScreenPunchItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <FullScreenPunchOverlay text={fsp.text} subtext={fsp.subtext} durationFrames={fsp.durationFrames} backgroundColor={fsp.backgroundColor} textColor={fsp.textColor} accentColor={fsp.accentColor} fontFamily={fsp.fontFamily} fontSize={fsp.fontSize} animation={fsp.animation} />
      </Sequence>
    );
  }

  if (overlay.type === "screen-flash") {
    const sf2 = overlay as ScreenFlashItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <ScreenFlashOverlay color={sf2.color} intensity={sf2.intensity} durationFrames={sf2.durationFrames} />
      </Sequence>
    );
  }

  if (overlay.type === "zoom-text") {
    const zt = overlay as ZoomTextItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <ZoomTextOverlay text={zt.text} position={zt.position} textColor={zt.textColor} fontFamily={zt.fontFamily} fontSize={zt.fontSize} accentColor={zt.accentColor} durationFrames={zt.durationFrames} customX={zt.customX} customY={zt.customY} startScale={zt.startScale} />
      </Sequence>
    );
  }

  if (overlay.type === "color-wipe") {
    const cw = overlay as ColorWipeItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <ColorWipeOverlay color={cw.color} direction={cw.direction} durationFrames={cw.durationFrames} thickness={cw.thickness} />
      </Sequence>
    );
  }

  if (overlay.type === "custom") {
    const cc = overlay as CustomCodeItem;
    return (
      <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
        <DynamicCodeOverlay code={cc.code} durationFrames={cc.durationFrames} />
      </Sequence>
    );
  }

  return null;
}

export const VideoEditorComposition: React.FC<VideoEditorProps> = ({ videoUrl, overlays }) => {
  const { durationInFrames } = useVideoConfig();
  const env = getRemotionEnvironment();
  const VideoComponent = env.isRendering ? OffthreadVideo : Video;
  const zoomPanOverlays = overlays.filter((o): o is ZoomPanItem => o.type === "zoom-pan");


  const transitions = overlays
    .filter((o): o is TransitionItem => o.type === "transition")
    .sort((a, b) => a.startFrame - b.startFrame);

  const nonTransitionOverlays = overlays.filter((o) => o.type !== "transition");

  if (transitions.length === 0) {
    return (
      <AbsoluteFill>
        {videoUrl && (
          <AbsoluteFill>
            <VideoComponent src={videoUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </AbsoluteFill>
        )}
        {nonTransitionOverlays.map((overlay) => renderNonTransitionOverlay(overlay))}
        {nonTransitionOverlays.filter(o => !!(o as any)._isProposed).map((overlay) => (
          <Sequence key={`${overlay.id}_proposed`} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
            <AbsoluteFill style={{ border: "2px dashed #E32652", opacity: 0.65, pointerEvents: "none" }} />
          </Sequence>
        ))}
      </AbsoluteFill>
    );
  }

  const clampedTransitions = transitions.map((tr) => {
    const start = Math.max(0, Math.min(tr.startFrame, durationInFrames - 1));
    const maxDur = durationInFrames - start;
    const dur = Math.max(1, Math.min(tr.durationFrames, maxDur));
    return { ...tr, startFrame: start, durationFrames: dur };
  });

  const validTransitions: TransitionItem[] = [];
  let lastEnd = 0;
  for (const tr of clampedTransitions) {
    if (tr.startFrame >= lastEnd) {
      validTransitions.push(tr);
      lastEnd = tr.startFrame + tr.durationFrames;
    }
  }

  if (validTransitions.length === 0) {
    return (
      <AbsoluteFill>
        {videoUrl && (
          <AbsoluteFill>
            <VideoComponent src={videoUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </AbsoluteFill>
        )}
        {nonTransitionOverlays.map((overlay) => renderNonTransitionOverlay(overlay))}
        {nonTransitionOverlays.filter(o => !!(o as any)._isProposed).map((overlay) => (
          <Sequence key={`${overlay.id}_proposed`} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
            <AbsoluteFill style={{ border: "2px dashed #E32652", opacity: 0.65, pointerEvents: "none" }} />
          </Sequence>
        ))}
      </AbsoluteFill>
    );
  }

  const scenes: { videoStartFrame: number; durationFrames: number }[] = [];
  let cursor = 0;

  for (let i = 0; i < validTransitions.length; i++) {
    const tr = validTransitions[i];
    const sceneEnd = tr.startFrame + tr.durationFrames;
    scenes.push({
      videoStartFrame: cursor,
      durationFrames: Math.max(1, sceneEnd - cursor),
    });
    cursor = tr.startFrame;
  }

  scenes.push({
    videoStartFrame: cursor,
    durationFrames: Math.max(1, durationInFrames - cursor),
  });

  return (
    <AbsoluteFill>
      {videoUrl ? (
        <TransitionSeries>
          {scenes.map((scene, i) => (
            <React.Fragment key={`scene-${i}`}>
              <TransitionSeries.Sequence durationInFrames={scene.durationFrames}>
                <VideoSceneContent videoUrl={videoUrl} videoStartFrame={scene.videoStartFrame} />
              </TransitionSeries.Sequence>
              {i < validTransitions.length && (
                <TransitionSeries.Transition
                  presentation={getTransitionPresentation(validTransitions[i].transitionType)}
                  timing={linearTiming({ durationInFrames: validTransitions[i].durationFrames })}
                />
              )}
            </React.Fragment>
          ))}
        </TransitionSeries>
      ) : null}

      {nonTransitionOverlays.map((overlay) => renderNonTransitionOverlay(overlay))}
      {nonTransitionOverlays.filter(o => !!(o as any)._isProposed).map((overlay) => (
        <Sequence key={`${overlay.id}_proposed`} from={overlay.startFrame} durationInFrames={overlay.durationFrames}>
          <AbsoluteFill style={{ border: "2px dashed #E32652", opacity: 0.65, pointerEvents: "none" }} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

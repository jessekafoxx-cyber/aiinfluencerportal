import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";

export interface LowerThirdProps {
  name: string;
  title: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  position: "bottom-left" | "bottom-center" | "bottom-right";
}

export const LowerThird: React.FC<LowerThirdProps> = ({
  name,
  title,
  accentColor,
  backgroundColor,
  textColor,
  fontFamily,
  position,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();

  const slideIn = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120 },
  });

  const slideOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [0, -100],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const barGrow = interpolate(slideIn, [0, 1], [0, 1]);

  const justifyContent =
    position === "bottom-left"
      ? "flex-start"
      : position === "bottom-right"
        ? "flex-end"
        : "center";

  const xOffset = interpolate(slideIn, [0, 1], [
    position === "bottom-right" ? 100 : -100,
    0,
  ]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
      }}
    >
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent,
          padding: "0 60px",
          opacity: fadeOut,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            transform: `translateX(${xOffset + slideOut}px)`,
          }}
        >
          <div
            style={{
              backgroundColor: accentColor,
              padding: "12px 32px",
              borderRadius: "4px 4px 0 0",
            }}
          >
            <span
              style={{
                fontFamily,
                fontSize: 32,
                fontWeight: 900,
                color: "#fff",
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              {name}
            </span>
          </div>

          <div
            style={{
              backgroundColor: `${backgroundColor}ee`,
              padding: "8px 32px",
              borderRadius: "0 0 4px 4px",
              transform: `scaleX(${barGrow})`,
              transformOrigin: position === "bottom-right" ? "right" : "left",
            }}
          >
            <span
              style={{
                fontFamily,
                fontSize: 20,
                color: textColor,
                letterSpacing: 3,
                textTransform: "uppercase",
                opacity: slideIn,
              }}
            >
              {title}
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

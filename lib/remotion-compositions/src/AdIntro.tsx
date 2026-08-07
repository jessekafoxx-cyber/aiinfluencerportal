import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
  Sequence,
} from "remotion";

export interface AdIntroProps {
  brandName: string;
  tagline: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
}

export const AdIntro: React.FC<AdIntroProps> = ({
  brandName,
  tagline,
  accentColor,
  backgroundColor,
  textColor,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.8 },
  });

  const barWidth = interpolate(frame, [10, 30], [0, width], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const pulseScale = interpolate(
    frame,
    [40, 50, 60, 70],
    [1, 1.05, 1, 1.02],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: height / 2 - 3,
          left: 0,
          width: barWidth,
          height: 6,
          backgroundColor: accentColor,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            transform: `scale(${logoScale * pulseScale})`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 16,
              backgroundColor: accentColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <span
              style={{
                fontFamily,
                fontSize: 40,
                fontWeight: 900,
                color: "#fff",
              }}
            >
              {brandName.charAt(0)}
            </span>
          </div>

          <span
            style={{
              fontFamily,
              fontSize: 64,
              fontWeight: 900,
              color: textColor,
              textTransform: "uppercase",
              letterSpacing: 6,
            }}
          >
            {brandName}
          </span>
        </div>
      </div>

      <Sequence from={25}>
        {(() => {
          const tagS = spring({
            frame: frame - 25,
            fps,
            config: { damping: 15, stiffness: 150 },
          });
          return (
            <div
              style={{
                position: "absolute",
                bottom: height / 2 - 120,
                left: 0,
                right: 0,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily,
                  fontSize: 24,
                  color: textColor,
                  opacity: tagS,
                  letterSpacing: 8,
                  textTransform: "uppercase",
                  transform: `translateY(${interpolate(tagS, [0, 1], [20, 0])}px)`,
                }}
              >
                {tagline}
              </span>
            </div>
          );
        })()}
      </Sequence>
    </AbsoluteFill>
  );
};

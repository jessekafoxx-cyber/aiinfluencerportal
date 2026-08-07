import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
  Sequence,
} from "remotion";

export interface SocialPostProps {
  headline: string;
  bodyText: string;
  ctaText: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  layout: "centered" | "left-aligned" | "split";
}

export const SocialPost: React.FC<SocialPostProps> = ({
  headline,
  bodyText,
  ctaText,
  accentColor,
  backgroundColor,
  textColor,
  fontFamily,
  layout,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const headlineS = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 180 },
  });

  const isSplit = layout === "split";
  const isLeft = layout === "left-aligned";
  const alignment = isLeft || isSplit ? "flex-start" : "center";
  const textAlign = isLeft || isSplit ? ("left" as const) : ("center" as const);

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        opacity: fadeOut,
        display: "flex",
        flexDirection: isSplit ? "row" : "column",
      }}
    >
      {isSplit && (
        <div
          style={{
            width: "40%",
            height: "100%",
            backgroundColor: accentColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              border: `4px solid ${textColor}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `scale(${headlineS})`,
            }}
          >
            <span
              style={{
                fontFamily,
                fontSize: 48,
                fontWeight: 900,
                color: "#fff",
              }}
            >
              AD
            </span>
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: alignment,
          justifyContent: "center",
          padding: isSplit ? "60px 50px" : "80px 100px",
          gap: 24,
        }}
      >
        <div
          style={{
            width: 60,
            height: 6,
            backgroundColor: accentColor,
            borderRadius: 3,
            transform: `scaleX(${headlineS})`,
            transformOrigin: isLeft || isSplit ? "left" : "center",
            marginBottom: 8,
          }}
        />

        <h1
          style={{
            fontFamily,
            fontSize: isSplit ? 44 : 56,
            fontWeight: 900,
            color: textColor,
            textTransform: "uppercase",
            lineHeight: 1.1,
            textAlign,
            margin: 0,
            transform: `translateY(${interpolate(headlineS, [0, 1], [40, 0])}px)`,
            opacity: headlineS,
          }}
        >
          {headline}
        </h1>

        <Sequence from={12}>
          {(() => {
            const bodyS = spring({
              frame: frame - 12,
              fps,
              config: { damping: 15, stiffness: 160 },
            });
            return (
              <p
                style={{
                  fontFamily,
                  fontSize: isSplit ? 18 : 22,
                  color: textColor,
                  opacity: bodyS * 0.8,
                  lineHeight: 1.6,
                  textAlign,
                  margin: 0,
                  maxWidth: 600,
                  transform: `translateY(${interpolate(bodyS, [0, 1], [20, 0])}px)`,
                }}
              >
                {bodyText}
              </p>
            );
          })()}
        </Sequence>

        <Sequence from={24}>
          {(() => {
            const ctaS = spring({
              frame: frame - 24,
              fps,
              config: { damping: 12, stiffness: 200 },
            });
            return (
              <div
                style={{
                  marginTop: 16,
                  padding: "14px 40px",
                  backgroundColor: accentColor,
                  borderRadius: 8,
                  transform: `scale(${ctaS})`,
                }}
              >
                <span
                  style={{
                    fontFamily,
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#fff",
                    textTransform: "uppercase",
                    letterSpacing: 2,
                  }}
                >
                  {ctaText}
                </span>
              </div>
            );
          })()}
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

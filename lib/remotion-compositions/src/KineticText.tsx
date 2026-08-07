import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
  Sequence,
} from "remotion";

export interface KineticTextProps {
  headline: string;
  subtext: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
}

export const KineticText: React.FC<KineticTextProps> = ({
  headline,
  subtext,
  accentColor,
  backgroundColor,
  textColor,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const words = headline.split(" ");

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 20,
          marginBottom: 40,
        }}
      >
        {words.map((word, i) => {
          const delay = i * 5;
          const s = spring({
            frame: frame - delay,
            fps,
            config: { damping: 12, stiffness: 200, mass: 0.5 },
          });

          const y = interpolate(s, [0, 1], [60, 0]);

          return (
            <span
              key={i}
              style={{
                fontFamily,
                fontSize: 80,
                fontWeight: 900,
                color: i % 3 === 0 ? accentColor : textColor,
                transform: `translateY(${y}px)`,
                opacity: s,
                textTransform: "uppercase",
                letterSpacing: -2,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      <Sequence from={Math.min(words.length * 5 + 10, durationInFrames - 30)}>
        {(() => {
          const localFrame = frame - Math.min(words.length * 5 + 10, durationInFrames - 30);
          const subS = spring({
            frame: localFrame,
            fps,
            config: { damping: 15, stiffness: 180 },
          });

          const lineWidth = interpolate(subS, [0, 1], [0, 200]);

          return (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: lineWidth,
                  height: 4,
                  backgroundColor: accentColor,
                  borderRadius: 2,
                }}
              />
              <span
                style={{
                  fontFamily,
                  fontSize: 28,
                  color: textColor,
                  opacity: subS,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                }}
              >
                {subtext}
              </span>
            </div>
          );
        })()}
      </Sequence>
    </AbsoluteFill>
  );
};

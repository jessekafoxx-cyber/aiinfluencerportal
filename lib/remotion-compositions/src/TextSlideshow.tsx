import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
  Sequence,
} from "remotion";

export interface TextSlideshowProps {
  slides: Array<{ text: string; subtext?: string }>;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
}

const Slide: React.FC<{
  text: string;
  subtext?: string;
  accentColor: string;
  textColor: string;
  fontFamily: string;
  slideDuration: number;
}> = ({ text, subtext, accentColor, textColor, fontFamily, slideDuration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterS = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 150 },
  });

  const exitS = interpolate(
    frame,
    [slideDuration - 10, slideDuration],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const lineWidth = interpolate(enterS, [0, 1], [0, 120]);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 100,
        opacity: exitS,
      }}
    >
      <div
        style={{
          width: lineWidth,
          height: 4,
          backgroundColor: accentColor,
          borderRadius: 2,
          marginBottom: 32,
        }}
      />

      <h1
        style={{
          fontFamily,
          fontSize: 60,
          fontWeight: 900,
          color: textColor,
          textAlign: "center",
          textTransform: "uppercase",
          lineHeight: 1.2,
          margin: 0,
          transform: `translateY(${interpolate(enterS, [0, 1], [50, 0])}px)`,
          opacity: enterS,
        }}
      >
        {text}
      </h1>

      {subtext && (
        <p
          style={{
            fontFamily,
            fontSize: 24,
            color: textColor,
            opacity: enterS * 0.7,
            textAlign: "center",
            marginTop: 20,
            letterSpacing: 2,
            transform: `translateY(${interpolate(enterS, [0, 1], [30, 0])}px)`,
          }}
        >
          {subtext}
        </p>
      )}

      <div
        style={{
          width: lineWidth,
          height: 4,
          backgroundColor: accentColor,
          borderRadius: 2,
          marginTop: 32,
        }}
      />
    </AbsoluteFill>
  );
};

export const TextSlideshow: React.FC<TextSlideshowProps> = ({
  slides,
  accentColor,
  backgroundColor,
  textColor,
  fontFamily,
}) => {
  const { durationInFrames } = useVideoConfig();
  const slideCount = slides.length || 1;
  const slideDuration = Math.floor(durationInFrames / slideCount);

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {slides.map((slide, i) => (
        <Sequence key={i} from={i * slideDuration} durationInFrames={slideDuration}>
          <Slide
            text={slide.text}
            subtext={slide.subtext}
            accentColor={accentColor}
            textColor={textColor}
            fontFamily={fontFamily}
            slideDuration={slideDuration}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

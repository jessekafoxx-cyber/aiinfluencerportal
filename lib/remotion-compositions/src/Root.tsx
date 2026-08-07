import { registerRoot, Composition } from "remotion";
import React from "react";
import { VideoEditorComposition } from "./VideoEditor";
import type { VideoEditorProps } from "./VideoEditor";

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VideoEditor"
        component={VideoEditorComposition}
        durationInFrames={300}
        fps={60}
        width={1920}
        height={1080}
        defaultProps={{
          videoUrl: "",
          overlays: [],
        } satisfies VideoEditorProps}
      />
    </>
  );
};

registerRoot(RemotionRoot);

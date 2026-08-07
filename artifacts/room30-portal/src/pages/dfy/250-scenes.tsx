import { DfyDriveGridPage } from "./drive-grid-page";

const TITLE = "250+ Scenes";
const DESCRIPTION =
  "250+ ready-to-use scene backdrops to drop your AI influencer or product into. Pulled live from our Google Drive - new scenes appear here automatically. Pick a setting to browse its scenes.";
const BASE_PATH = "/done-for-you-pack/250-scenes";

export default function Dfy250Scenes() {
  return (
    <DfyDriveGridPage
      slug="250-scenes"
      title={TITLE}
      description={DESCRIPTION}
      basePath={BASE_PATH}
    />
  );
}

export function Dfy250ScenesFolder({ subfolderId }: { subfolderId: string }) {
  return (
    <DfyDriveGridPage
      slug="250-scenes"
      title={TITLE}
      description={DESCRIPTION}
      basePath={BASE_PATH}
      subfolderId={subfolderId}
    />
  );
}

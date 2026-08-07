import { syncDriveScenes } from "@workspace/api-server/lib/influencer-pipeline";

async function main() {
  const folderId = process.env.INFLUENCER_SCENES_FOLDER_ID || "14ID_WABuMmA5bRgQfBnUCSNJc8UUHGZS";
  console.log(`Syncing scenes from Drive folder ${folderId} ...`);
  const result = await syncDriveScenes({ folderId });
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});

// Kept dependency-free so model grounding does not load media binaries or OCR workers.
export function mediaContext(result){if(!result?.accepted)return '';return `本作品导入素材识别（经用户核对；不代表平台全部内容，抽帧之间可能遗漏）：\n${result.text}`;}

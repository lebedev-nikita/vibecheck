/**
 * Re-encodes an image as a JPEG no wider or taller than `maxEdge`, so it costs
 * fewer tokens. Transparent areas become white. Returns base64 without prefix.
 */
export const downscaleToJpeg = async (image: Blob, maxEdge: number): Promise<string> => {
  const bitmap = await createImageBitmap(image);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

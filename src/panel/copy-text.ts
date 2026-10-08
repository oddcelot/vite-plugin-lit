/**
 * Put `text` on the clipboard. The async Clipboard API is refused in some
 * hosts the panel runs in (a DevTools extension panel without focus, an
 * iframe without the permission), so a refusal falls back to selecting a
 * hidden textarea and `execCommand('copy')`. Resolves to whether either way
 * worked; never throws.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
};

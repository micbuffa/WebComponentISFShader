export function parseISF(source) {
  const match = source.match(/\/\*([\s\S]*?)\*\//);
  if (!match) {
    throw new Error('Bloc JSON ISF introuvable');
  }

  const raw = match[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end < 0) {
    throw new Error('Métadonnées ISF invalides');
  }

  let metadata;
  try {
    metadata = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new Error(`JSON ISF invalide: ${err.message}`);
  }

  const shaderBody = source.replace(match[0], '').trim();
  return { metadata, shaderBody, originalSource: source };
}

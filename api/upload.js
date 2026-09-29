import { handleUpload } from '@vercel/blob/client';

// Upload direct navigateur -> Blob (contourne la limite de 4,5 Mo des fonctions, nécessaire pour les vidéos).
export default async function handler(req, res) {
  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!process.env.APP_PASSWORD || clientPayload !== process.env.APP_PASSWORD) throw new Error('Mot de passe incorrect');
        if (!pathname.startsWith('trips/') || pathname.includes('..')) throw new Error('Chemin invalide');
        return {
          allowedContentTypes: ['image/*', 'video/*', 'audio/*', 'text/plain'],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    res.json(json);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

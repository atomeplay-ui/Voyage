import { handleUploadPresigned } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { requireUser } from './_db.js';

const allowedContentTypes = ['image/*', 'video/*', 'audio/*'];

// Upload direct navigateur -> Blob via URL signée (contourne la limite de 4,5 Mo des fonctions, nécessaire pour les vidéos).
// Réservé aux utilisateurs connectés.
export default async function handler(req, res) {
  if (!await requireUser(req, res)) return;
  try {
    const json = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async pathname => {
        if (!pathname.startsWith('trips/') || pathname.includes('..')) throw new Error('Chemin invalide');
        return {
          token: await issueSignedToken({ pathname, operations: ['put'], allowedContentTypes }),
          urlOptions: { addRandomSuffix: true, allowedContentTypes },
        };
      },
    });
    res.json(json);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

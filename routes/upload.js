const express    = require('express');
const multer     = require('multer');
const cloudinary = require('../config/cloudinary');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: process.env.CLOUDINARY_FOLDER || 'scramfck' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    console.error('[upload] Cloudinary error:', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

module.exports = router;

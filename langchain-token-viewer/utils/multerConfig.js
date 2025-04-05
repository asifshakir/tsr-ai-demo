// utils/multerConfig.js
import multer from "multer";
import path from "path";

export const storage = multer.diskStorage({
  destination: "./uploads",
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${Date.now()}${ext}`);
  },
});

export const upload = multer({ storage });
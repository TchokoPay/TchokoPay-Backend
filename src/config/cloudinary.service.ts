import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder, // ✅ dynamic folder from service
          resource_type: 'image',

          // 🔥 Compression & optimization
          quality: 'auto',
          fetch_format: 'auto',

          // ⚡ Enhancements
          flags: 'progressive',
          transformation: [
            { width: 1000, crop: 'limit' }, // prevent oversized uploads
          ],
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );

      streamifier
        .createReadStream(file.buffer)
        .pipe(uploadStream);
    });
  }
}
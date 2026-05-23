import { useEffect, useRef, useState } from 'react';
import exifr from 'exifr';

type ExifFields = {
  DateTimeOriginal?: Date | string;
  CreateDate?: Date | string;
  ModifyDate?: Date | string;
  DateCreated?: Date | string;
  OffsetTimeOriginal?: string;
  Model?: string;
  Make?: string;
};

type ProcessedPhoto = {
  url: string;
  filename: string;
  displayDate: string;
};

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

function normalizeExifDate(value: Date | string | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const exifMatch = trimmed.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);

  if (exifMatch) {
    const [, year, month, day, hour, minute, second = '00'] = exifMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findCaptureDate(exif: ExifFields) {
  const candidates = ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate'] as const;

  for (const key of candidates) {
    const date = normalizeExifDate(exif[key]);
    if (date) {
      return date;
    }
  }

  return null;
}

function formatStampDate(date: Date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  return `${year}${month}${day}`;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load the selected image.'));
    };
    img.src = objectUrl;
  });
}

function drawTimestamp(canvas: HTMLCanvasElement, img: HTMLImageElement, stamp: string) {
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas is not available in this browser.');
  }

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  const shortestSide = Math.min(canvas.width, canvas.height);
  const fontSize = Math.max(22, Math.round(shortestSide * 0.045));
  const insetX = Math.max(26, Math.round(shortestSide * 0.05));
  const insetY = Math.max(28, Math.round(shortestSide * 0.06));
  const x = canvas.width - insetX;
  const y = canvas.height - insetY;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.font = `400 ${fontSize}px "Arial Narrow", "Helvetica Neue", Arial, Tahoma, sans-serif`;
  ctx.letterSpacing = '0.04em';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const strokeWidth = Math.max(2, fontSize * 0.075);

  ctx.fillStyle = '#000000';
  ctx.fillText(stamp, x + 1, y + 1);

  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(stamp, x, y);

  ctx.fillStyle = '#f4e86a';
  ctx.fillText(stamp, x, y);
  ctx.restore();
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not export the stamped photo.'));
        }
      },
      'image/jpeg',
      0.94,
    );
  });
}

function outputFilename(name: string) {
  const cleanName = name.replace(/\.[^.]+$/, '');
  return `${cleanName || 'photo'}-timestamped.jpg`;
}

export default function App() {
  const [photo, setPhoto] = useState<ProcessedPhoto | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    return () => {
      if (photo) {
        URL.revokeObjectURL(photo.url);
      }
    };
  }, [photo]);

  async function processFile(file: File) {
    setIsProcessing(true);
    setError(null);

    try {
      const exif = ((await exifr.parse(file, [
        'DateTimeOriginal',
        'CreateDate',
        'ModifyDate',
        'DateCreated',
      ])) ?? {}) as ExifFields;
      const capture = findCaptureDate(exif);

      if (!capture) {
        throw new Error('No usable EXIF capture timestamp was found in this photo.');
      }

      const img = await loadImage(file);
      const stamp = formatStampDate(capture);
      const canvas = canvasRef.current;

      if (!canvas) {
        throw new Error('Canvas is not ready yet.');
      }

      drawTimestamp(canvas, img, stamp);
      const blob = await canvasToJpeg(canvas);
      const url = URL.createObjectURL(blob);

      setPhoto((current) => {
        if (current) {
          URL.revokeObjectURL(current.url);
        }

        return {
          url,
          filename: outputFilename(file.name),
          displayDate: stamp,
        };
      });
    } catch (caughtError) {
      setPhoto((current) => {
        if (current) {
          URL.revokeObjectURL(current.url);
        }

        return null;
      });
      setError(caughtError instanceof Error ? caughtError.message : 'Something went wrong while processing the photo.');
    } finally {
      setIsProcessing(false);
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please choose a JPEG, HEIC, PNG, or another browser-readable image.');
      return;
    }

    void processFile(file);
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <h1 id="page-title">timestamp photos</h1>
        <p>Add the original EXIF date to the bottom-right corner. Nothing uploads.</p>
      </section>

      <div
        className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFile(event.dataTransfer.files[0]);
        }}
      >
        <input
          id="photo-upload"
          type="file"
          accept="image/*"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <label htmlFor="photo-upload">{isProcessing ? 'processing...' : 'choose photo'}</label>
      </div>

      {error ? <p className="notice" role="alert">{error}</p> : null}

      <section className="preview" aria-live="polite">
        {photo ? (
          <>
            <div className="photo-card">
              <img alt="Timestamped result" src={photo.url} />
            </div>
            <a className="download" download={photo.filename} href={photo.url}>
              download
            </a>
          </>
        ) : (
          <div className="empty-state">
            Drop an original photo here.
          </div>
        )}
      </section>

      <canvas ref={canvasRef} hidden />
    </main>
  );
}

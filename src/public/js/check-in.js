import { pageTranslator } from '/shared/i18n/browser.js';

const t = await pageTranslator();
const cameraButton = document.querySelector('#start-camera');
const stopButton = document.querySelector('#stop-camera');
const video = document.querySelector('#check-in-camera');
const cameraStatus = document.querySelector('#camera-status');
const lookupForm = document.querySelector('form[action="/check-in/preview"]');

const UNAVAILABLE = t('Camera access is unavailable. Enter the pass code manually or ask an organizer for help.');
const FAILED = t('Camera scan failed. Enter the pass code manually or ask an organizer for help.');

async function createDecoder() {
  if (typeof window.BarcodeDetector?.getSupportedFormats === 'function') {
    const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
    if (formats.includes('qr_code')) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      return async () => (await detector.detect(video))[0]?.rawValue ?? null;
    }
  }
  const { default: jsQR } = await import('/vendor/jsqr.mjs');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async () => {
    if (!video.videoWidth) return null;
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

if (cameraButton && video && cameraStatus && lookupForm) {
  let stream;
  let scanning = false;

  const stopCamera = () => {
    scanning = false;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.hidden = true;
    cameraButton.hidden = false;
    if (stopButton) stopButton.hidden = true;
  };

  stopButton?.addEventListener('click', () => {
    stopCamera();
    cameraStatus.textContent = t('Camera stopped.');
  });

  cameraButton.addEventListener('click', async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      cameraStatus.textContent = UNAVAILABLE;
      return;
    }

    try {
      const decode = await createDecoder();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream;
      video.hidden = false;
      cameraButton.hidden = true;
      if (stopButton) stopButton.hidden = false;
      await video.play();
      scanning = true;
      cameraStatus.textContent = t('Point the camera at a household entry pass.');

      const scan = async () => {
        if (!scanning) return;
        try {
          const value = await decode();
          if (value) {
            lookupForm.querySelector('input[name="token"]').value = value;
            stopCamera();
            cameraStatus.textContent = t('Pass scanned. Looking it up…');
            lookupForm.requestSubmit();
            return;
          }
        } catch {
          stopCamera();
          cameraStatus.textContent = FAILED;
          return;
        }
        window.setTimeout(scan, 250);
      };
      scan();
    } catch (error) {
      stopCamera();
      cameraStatus.textContent = error.name === 'NotAllowedError' ? UNAVAILABLE : FAILED;
    }
  });
}
const cameraButton = document.querySelector('#start-camera');
const video = document.querySelector('#check-in-camera');
const cameraStatus = document.querySelector('#camera-status');
const lookupForm = document.querySelector('form[action="/check-in/preview"]');

if (cameraButton && video && cameraStatus && lookupForm) {
  let stream;
  let scanning = false;

  const stopCamera = () => {
    scanning = false;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.hidden = true;
  };

  cameraButton.addEventListener('click', async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !('BarcodeDetector' in window)) {
      cameraStatus.textContent = 'Camera access is unavailable. Enter the pass code manually or ask an organizer for help.';
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      scanning = true;
      cameraStatus.textContent = 'Point the camera at a household entry pass.';

      const scan = async () => {
        if (!scanning) return;
        try {
          const [code] = await detector.detect(video);
          if (code?.rawValue) {
            lookupForm.querySelector('input[name="token"]').value = code.rawValue;
            stopCamera();
            lookupForm.requestSubmit();
            return;
          }
        } catch {
          stopCamera();
          cameraStatus.textContent = 'Camera scan failed. Enter the pass code manually or ask an organizer for help.';
          return;
        }
        window.setTimeout(scan, 250);
      };
      scan();
    } catch (error) {
      stopCamera();
      cameraStatus.textContent = error.name === 'NotAllowedError'
        ? 'Camera access is unavailable. Enter the pass code manually or ask an organizer for help.'
        : 'Camera scan failed. Enter the pass code manually or ask an organizer for help.';
    }
  });
}
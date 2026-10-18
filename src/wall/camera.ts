/**
 * The wall's own copy of the tracking camera, for the live view in the corner.
 * Chrome shares one camera between windows, so this doesn't take it away from
 * the control window. Same constraints as the control window, so the camera
 * isn't asked to switch formats.
 */
export class WallCamera {
  readonly video = document.createElement('video');
  label = '';
  private deviceId: string | null = null;
  private request = 0;

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  get ready() {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async open(deviceId: string | null, label: string) {
    this.label = label;
    if (!deviceId || deviceId === this.deviceId) return;
    this.deviceId = deviceId;
    const req = ++this.request;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
        audio: false,
      });
      if (req !== this.request) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stop();
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
    } catch {
      // no permission in this window, or the camera is busy: the live view shows the skeleton only
      if (req === this.request) this.deviceId = null;
    }
  }

  stop() {
    (this.video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }
}

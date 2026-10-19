/**
 * The wall's own copy of the tracking camera, for the live view in the corner.
 * Chrome shares one camera between windows, so this doesn't take it away from
 * the control window. Same constraints as the control window, so the camera
 * isn't asked to switch formats.
 *
 * The control window re-sends its camera every couple of seconds, so if the
 * stream here dies (the iPhone dropped off and reconnected, or switching
 * cameras raced), the next message opens it again.
 */
export class WallCamera {
  readonly video = document.createElement('video');
  label = '';
  private deviceId: string | null = null;
  private request = 0;
  private opening = false;

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  private get track(): MediaStreamTrack | undefined {
    return (this.video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  }

  /** Showing real frames: a dead or muted stream keeps its size but goes black. */
  get ready() {
    const t = this.track;
    return !!t && t.readyState === 'live' && !t.muted && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async open(deviceId: string | null, label: string) {
    this.label = label;
    if (!deviceId) return;
    const healthy = deviceId === this.deviceId && this.track?.readyState === 'live';
    if (healthy || (this.opening && deviceId === this.deviceId)) return;
    this.deviceId = deviceId;
    this.opening = true;
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
      // no permission in this window, or the camera is busy: show the skeleton only,
      // and try again when the control window next sends its camera
      if (req === this.request) this.stop();
    } finally {
      if (req === this.request) this.opening = false;
    }
  }

  stop() {
    this.track?.stop();
    (this.video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }
}

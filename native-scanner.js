/** Native UPC/EAN camera reader. The caller owns fallback to html5-qrcode. */
export async function startNativeScanner(root, onDecode, signal) {
    if (!globalThis.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) throw new Error('Native barcode scanning is unavailable');
    const desired = ['upc_a', 'upc_e', 'ean_13', 'ean_8'];
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = desired.filter(format => supported.includes(format));
    if (!formats.length) throw new Error('Native UPC/EAN scanning is unavailable');
    signal.throwIfAborted();
    const detector = new BarcodeDetector({ formats });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true; video.className = 'native-scanner-video'; video.srcObject = stream;
    let timer, closed = false;
    function stop() {
        if (closed) return; closed = true; clearTimeout(timer);
        stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null; video.remove(); signal.removeEventListener('abort', stop);
    }
    try {
        signal.throwIfAborted(); signal.addEventListener('abort', stop, { once: true }); root.replaceChildren(video); await video.play(); signal.throwIfAborted();
        async function detect() {
            if (closed) return;
            try {
                const matches = await detector.detect(video);
                if (!closed && matches[0]?.rawValue) onDecode(matches[0].rawValue);
            } catch { /* A camera frame may not be available yet. */ }
            if (!closed) timer = setTimeout(detect, 100);
        }
        timer = setTimeout(detect, 100);
        return { stop };
    } catch (error) { stop(); throw error; }
}

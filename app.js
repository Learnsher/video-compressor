let ffmpeg = null;
let videoFile = null;
let videoInfo = null;
let compressedBlob = null;

// 等待ffmpeg載入
async function waitForFFmpeg() {
    while (!window.ffmpegReady) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await waitForFFmpeg();
    
    ffmpeg = new window.FFmpeg();
    ffmpeg.on('log', ({ message }) => console.log(message));
    ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.round(progress * 100);
        document.getElementById('progressBar').style.width = percent + '%';
    });

    setupEventListeners();
});

// setupEventListeners 保持不變...
function setupEventListeners() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0]);
    });

    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('crfOption').classList.toggle('hidden', e.target.value !== 'crf');
            document.getElementById('bitrateOption').classList.toggle('hidden', e.target.value !== 'bitrate');
            document.getElementById('sizeOption').classList.toggle('hidden', e.target.value !== 'size');
            updatePrediction();
        });
    });

    document.getElementById('crf').addEventListener('input', (e) => {
        document.getElementById('crfValue').textContent = e.target.value;
        updatePrediction();
    });

    ['codec', 'bitrate', 'targetSize', 'resolution', 'fps', 'audioBitrate'].forEach(id => {
        document.getElementById(id).addEventListener('change', updatePrediction);
    });

    document.getElementById('compressBtn').addEventListener('click', compressVideo);
    document.getElementById('downloadBtn').addEventListener('click', downloadVideo);
}

// 修正的handleFile函數
async function handleFile(file) {
    if (!file || !file.type.startsWith('video/')) {
        alert('請上傳影片檔案');
        return;
    }

    videoFile = file;
    
    if (!ffmpeg.loaded) {
        document.getElementById('uploadArea').innerHTML = '<p>⏳ 載入壓縮引擎中...（首次需下載約31MB，請稍候）</p>';
        
        try {
            const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
            await ffmpeg.load({
                coreURL: await window.toBlobURL(
                    `${baseURL}/ffmpeg-core.js`,
                    'text/javascript'
                ),
                wasmURL: await window.toBlobURL(
                    `${baseURL}/ffmpeg-core.wasm`,
                    'application/wasm'
                ),
            });
            document.getElementById('uploadArea').innerHTML = '<p>📁 點擊或拖放影片檔案</p>';
        } catch (error) {
            document.getElementById('uploadArea').innerHTML = '<p style="color:red">❌ 載入失敗，請重新整理頁面</p>';
            console.error(error);
            return;
        }
    }

    await analyzeVideo(file);
    document.getElementById('videoInfo').classList.remove('hidden');
    document.getElementById('optionsPanel').classList.remove('hidden');
    updatePrediction();
}

// 其他函數保持不變（analyzeVideo, updatePrediction, compressVideo, downloadVideo）
async function analyzeVideo(file) {
    const arrayBuffer = await file.arrayBuffer();
    await ffmpeg.writeFile('input.mp4', new Uint8Array(arrayBuffer));
    
    videoInfo = {
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2),
    };
    
    document.getElementById('infoContent').innerHTML = `
        檔案名稱: ${videoInfo.name}<br>
        檔案大小: ${videoInfo.size} MB<br>
        格式: ${file.type}
    `;
}

function updatePrediction() {
    if (!videoFile || !videoInfo) return;
    
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const duration = 5; // 簡化估算
    const audioBitrate = parseInt(document.getElementById('audioBitrate').value) / 1000;
    
    let predictedSize = 0;
    
    if (mode === 'size') {
        predictedSize = parseFloat(document.getElementById('targetSize').value);
    } else if (mode === 'bitrate') {
        const videoBitrate = parseFloat(document.getElementById('bitrate').value);
        predictedSize = ((videoBitrate + audioBitrate) * duration) / 8;
    } else {
        const crf = parseInt(document.getElementById('crf').value);
        const baseBitrate = 5 * Math.exp((23 - crf) * 0.1);
        predictedSize = ((baseBitrate + audioBitrate) * duration) / 8;
    }
    
    const reduction = ((1 - predictedSize / parseFloat(videoInfo.size)) * 100).toFixed(0);
    
    document.getElementById('prediction').innerHTML = `
        📊 預計輸出大小: <strong>${predictedSize.toFixed(2)} MB</strong> 
        (壓縮率約 ${reduction > 0 ? reduction : 0}%)
    `;
    document.getElementById('prediction').classList.remove('hidden');
}

async function compressVideo() {
    const compressBtn = document.getElementById('compressBtn');
    const progress = document.getElementById('progress');
    
    compressBtn.disabled = true;
    compressBtn.textContent = '⏳ 壓縮中...';
    progress.style.display = 'block';
    
    try {
        const mode = document.querySelector('input[name="mode"]:checked').value;
        const codec = document.getElementById('codec').value;
        const resolution = document.getElementById('resolution').value;
        const fps = document.getElementById('fps').value;
        const audioBitrate = document.getElementById('audioBitrate').value;
        
        let args = ['-i', 'input.mp4'];
        
        if (mode === 'crf') {
            const crf = document.getElementById('crf').value;
            args.push('-c:v', codec, '-crf', crf);
        } else if (mode === 'bitrate') {
            const bitrate = document.getElementById('bitrate').value + 'M';
            args.push('-c:v', codec, '-b:v', bitrate);
        } else {
            const targetSize = parseFloat(document.getElementById('targetSize').value);
            const duration = 5;
            const audioBitrateKbps = parseInt(audioBitrate);
            const targetBitrate = ((targetSize * 8 * 1024) / duration) - audioBitrateKbps;
            args.push('-c:v', codec, '-b:v', Math.max(500, targetBitrate) + 'k');
        }
        
        if (resolution !== 'original') {
            args.push('-vf', `scale=${resolution}`);
        }
        
        if (fps !== 'original') {
            args.push('-r', fps);
        }
        
        args.push('-c:a', 'aac', '-b:a', audioBitrate);
        args.push('output.mp4');
        
        await ffmpeg.exec(args);
        
        const data = await ffmpeg.readFile('output.mp4');
        compressedBlob = new Blob([data.buffer], { type: 'video/mp4' });
        
        const outputSize = (compressedBlob.size / 1024 / 1024).toFixed(2);
        const reduction = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0);
        
        document.getElementById('prediction').innerHTML = `
            ✅ 壓縮完成！<br>
            原始大小: ${videoInfo.size} MB → 壓縮後: <strong>${outputSize} MB</strong><br>
            減少了 ${reduction}% 的檔案大小
        `;
        
        document.getElementById('downloadBtn').classList.remove('hidden');
        compressBtn.textContent = '✅ 壓縮完成';
        
    } catch (error) {
        alert('壓縮失敗: ' + error.message);
        compressBtn.disabled = false;
        compressBtn.textContent = '🚀 開始壓縮';
    } finally {
        progress.style.display = 'none';
    }
}

function downloadVideo() {
    if (!compressedBlob) return;
    
    const url = URL.createObjectURL(compressedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = videoFile.name.replace(/\.[^/.]+$/, '') + '_compressed.mp4';
    a.click();
    URL.revokeObjectURL(url);
}

let ffmpeg = null;
let videoFile = null;
let videoInfo = null;
let compressedBlob = null;

// 等待 FFmpeg 載入
async function initFFmpeg() {
    const { FFmpeg } = window;
    const { toBlobURL } = window;
    
    ffmpeg = new FFmpeg();
    
    ffmpeg.on('log', ({ message }) => {
        console.log(message);
        parseFFmpegLog(message);
    });
    
    ffmpeg.on('progress', ({ progress, time }) => {
        const percent = Math.round(progress * 100);
        document.getElementById('progressBar').style.width = percent + '%';
    });

    // 混合方案：JS本地，WASM用CDN
    await ffmpeg.load({
        coreURL: await toBlobURL('./ffmpeg-core/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm', 'application/wasm'),
    });
    
    return ffmpeg;
}


function parseFFmpegLog(message) {
    // 提取時長
    const durationMatch = message.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
    if (durationMatch && videoInfo) {
        const hours = parseInt(durationMatch[1]);
        const minutes = parseInt(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);
        videoInfo.duration = hours * 3600 + minutes * 60 + seconds;
    }
    
    // 提取比特率
    const bitrateMatch = message.match(/bitrate:\s+(\d+)\s+kb\/s/);
    if (bitrateMatch && videoInfo) {
        videoInfo.bitrate = parseInt(bitrateMatch[1]);
    }
    
    // 提取解析度
    const resolutionMatch = message.match(/(\d{3,4})x(\d{3,4})/);
    if (resolutionMatch && videoInfo) {
        videoInfo.resolution = `${resolutionMatch[1]}×${resolutionMatch[2]}`;
    }
}

function showStatus(message, type = 'loading') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.classList.remove('hidden');
}

function hideStatus() {
    document.getElementById('status').classList.add('hidden');
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    // 點擊上傳
    uploadArea.addEventListener('click', () => fileInput.click());
    
    // 檔案選擇
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    
    // 拖放
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
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    // 模式切換
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('crfOption').classList.toggle('hidden', e.target.value !== 'crf');
            document.getElementById('bitrateOption').classList.toggle('hidden', e.target.value !== 'bitrate');
            document.getElementById('sizeOption').classList.toggle('hidden', e.target.value !== 'size');
            updatePrediction();
        });
    });

    // CRF slider
    document.getElementById('crf').addEventListener('input', (e) => {
        document.getElementById('crfValue').textContent = e.target.value;
        updatePrediction();
    });

    // 所有選項變更時更新預測
    ['codec', 'bitrate', 'targetSize', 'resolution', 'fps', 'audioBitrate'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', updatePrediction);
            element.addEventListener('input', updatePrediction);
        }
    });

    // 壓縮按鈕
    document.getElementById('compressBtn').addEventListener('click', compressVideo);
    
    // 下載按鈕
    document.getElementById('downloadBtn').addEventListener('click', downloadVideo);
}

async function handleFile(file) {
    if (!file || !file.type.startsWith('video/')) {
        alert('❌ 請上傳影片檔案');
        return;
    }

    if (file.size > 500 * 1024 * 1024) {
        alert('⚠️ 檔案過大（>500MB），可能會導致瀏覽器崩潰');
    }

    videoFile = file;
    document.getElementById('uploadArea').classList.add('loading');
    
    try {
        // 載入 ffmpeg (首次)
        if (!ffmpeg) {
            showStatus('🔧 首次載入壓縮引擎（約30秒）...', 'loading');
            await initFFmpeg();
        }

        // 分析影片
        showStatus('🔍 分析影片中...', 'loading');
        await analyzeVideo(file);
        
        hideStatus();
        document.getElementById('videoInfo').classList.remove('hidden');
        document.getElementById('optionsPanel').classList.remove('hidden');
        updatePrediction();
        
    } catch (error) {
        showStatus('❌ 載入失敗: ' + error.message, 'error');
        console.error(error);
    } finally {
        document.getElementById('uploadArea').classList.remove('loading');
    }
}

async function analyzeVideo(file) {
    const arrayBuffer = await file.arrayBuffer();
    await ffmpeg.writeFile('input.mp4', new Uint8Array(arrayBuffer));
    
    // 初始化 videoInfo
    videoInfo = {
        name: file.name,
        size: file.size / 1024 / 1024,
        duration: 0,
        bitrate: 0,
        resolution: '',
        codec: file.type
    };
    
    // 執行 ffprobe (通過 ffmpeg)
    try {
        await ffmpeg.exec(['-i', 'input.mp4']);
    } catch (e) {
        // ffmpeg -i 會返回錯誤，但 log 已經記錄資訊
    }
    
    // 等待 log 解析
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 如果沒有取得時長，使用估算
    if (!videoInfo.duration) {
        videoInfo.duration = 5; // 預設
    }
    
    if (!videoInfo.bitrate && videoInfo.duration > 0) {
        videoInfo.bitrate = Math.round((file.size * 8) / videoInfo.duration / 1000); // kbps
    }
    
    // 顯示資訊
    document.getElementById('infoContent').innerHTML = `
        <div class="info-row"><span class="info-label">檔案名稱:</span><span class="info-value">${videoInfo.name}</span></div>
        <div class="info-row"><span class="info-label">檔案大小:</span><span class="info-value">${videoInfo.size.toFixed(2)} MB</span></div>
        <div class="info-row"><span class="info-label">時長:</span><span class="info-value">${videoInfo.duration.toFixed(2)} 秒</span></div>
        <div class="info-row"><span class="info-label">比特率:</span><span class="info-value">${videoInfo.bitrate} kbps (${(videoInfo.bitrate/1000).toFixed(2)} Mbps)</span></div>
        ${videoInfo.resolution ? `<div class="info-row"><span class="info-label">解析度:</span><span class="info-value">${videoInfo.resolution}</span></div>` : ''}
        <div class="info-row"><span class="info-label">格式:</span><span class="info-value">${file.type}</span></div>
    `;
}

function updatePrediction() {
    if (!videoFile || !videoInfo || videoInfo.duration === 0) return;
    
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const duration = videoInfo.duration;
    const audioBitrate = parseInt(document.getElementById('audioBitrate').value) / 1000; // kbps to Mbps
    
    let predictedSize = 0;
    
    if (mode === 'size') {
        predictedSize = parseFloat(document.getElementById('targetSize').value);
    } else if (mode === 'bitrate') {
        const videoBitrate = parseFloat(document.getElementById('bitrate').value);
        predictedSize = ((videoBitrate + audioBitrate) * duration) / 8;
    } else {
        // CRF 模式估算
        const crf = parseInt(document.getElementById('crf').value);
        const originalBitrate = videoInfo.bitrate / 1000; // Mbps
        // CRF 23 約等於原始，每增加6約減半
        const factor = Math.pow(0.5, (crf - 23) / 6);
        const estimatedBitrate = originalBitrate * factor;
        predictedSize = ((estimatedBitrate + audioBitrate) * duration) / 8;
    }
    
    const reduction = ((1 - predictedSize / videoInfo.size) * 100);
    
    document.getElementById('prediction').innerHTML = `
        📊 預計輸出大小: <strong>${predictedSize.toFixed(2)} MB</strong> 
        ${reduction > 0 ? `(壓縮約 ${reduction.toFixed(0)}%)` : `(增加約 ${Math.abs(reduction).toFixed(0)}%)`}
    `;
    document.getElementById('prediction').classList.remove('hidden');
}

async function compressVideo() {
    const compressBtn = document.getElementById('compressBtn');
    const progress = document.getElementById('progress');
    const downloadBtn = document.getElementById('downloadBtn');
    
    compressBtn.disabled = true;
    compressBtn.textContent = '⏳ 壓縮中...';
    progress.style.display = 'block';
    downloadBtn.classList.add('hidden');
    
    try {
        // 建立 ffmpeg 指令
        const mode = document.querySelector('input[name="mode"]:checked').value;
        const codec = document.getElementById('codec').value;
        const resolution = document.getElementById('resolution').value;
        const fps = document.getElementById('fps').value;
        const audioBitrate = document.getElementById('audioBitrate').value;
        
        let args = ['-i', 'input.mp4'];
        
        // 影片編碼
        if (mode === 'crf') {
            const crf = document.getElementById('crf').value;
            args.push('-c:v', codec, '-crf', crf, '-preset', 'medium');
        } else if (mode === 'bitrate') {
            const bitrate = document.getElementById('bitrate').value + 'M';
            args.push('-c:v', codec, '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', (parseFloat(document.getElementById('bitrate').value) * 2) + 'M');
        } else {
            // 目標大小模式
            const targetSize = parseFloat(document.getElementById('targetSize').value);
            const duration = videoInfo.duration;
            const audioBitrateKbps = parseInt(audioBitrate);
            const targetBitrate = Math.max(500, ((targetSize * 8 * 1024) / duration) - audioBitrateKbps);
            args.push('-c:v', codec, '-b:v', Math.round(targetBitrate) + 'k', '-maxrate', Math.round(targetBitrate * 1.5) + 'k', '-bufsize', Math.round(targetBitrate * 2) + 'k');
        }
        
        // 解析度
        if (resolution !== 'original') {
            args.push('-vf', `scale=${resolution}`);
        }
        
        // 幀率
        if (fps !== 'original') {
            args.push('-r', fps);
        }
        
        // 音訊
        args.push('-c:a', 'aac', '-b:a', audioBitrate);
        
        // 其他優化
        args.push('-movflags', '+faststart'); // Web 優化
        
        // 輸出
        args.push('output.mp4');
        
        console.log('FFmpeg command:', args.join(' '));
        
        // 執行壓縮
        await ffmpeg.exec(args);
        
        // 讀取輸出
        const data = await ffmpeg.readFile('output.mp4');
        compressedBlob = new Blob([data.buffer], { type: 'video/mp4' });
        
        // 顯示結果
        const outputSize = (compressedBlob.size / 1024 / 1024).toFixed(2);
        const reduction = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(1);
        
        document.getElementById('prediction').innerHTML = `
            ✅ <strong>壓縮完成！</strong><br>
            原始大小: ${videoInfo.size.toFixed(2)} MB → 壓縮後: <strong>${outputSize} MB</strong><br>
            ${parseFloat(reduction) > 0 ? `減少了 ${reduction}%` : `增加了 ${Math.abs(reduction)}%`}
        `;
        document.getElementById('prediction').className = 'prediction';
        document.getElementById('prediction').style.background = '#e8f5e9';
        document.getElementById('prediction').style.borderLeftColor = '#4caf50';
        
        downloadBtn.classList.remove('hidden');
        compressBtn.textContent = '✅ 壓縮完成';
        
        // 清理臨時檔案
        try {
            await ffmpeg.deleteFile('input.mp4');
            await ffmpeg.deleteFile('output.mp4');
        } catch (e) {}
        
    } catch (error) {
        console.error('Compression error:', error);
        showStatus('❌ 壓縮失敗: ' + error.message, 'error');
        compressBtn.disabled = false;
        compressBtn.textContent = '🚀 開始壓縮';
    } finally {
        progress.style.display = 'none';
        document.getElementById('progressBar').style.width = '0%';
    }
}

function downloadVideo() {
    if (!compressedBlob) return;
    
    const url = URL.createObjectURL(compressedBlob);
    const a = document.createElement('a');
    a.href = url;
    const originalName = videoFile.name.replace(/\.[^/.]+$/, '');
    a.download = `${originalName}_compressed.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('✅ 下載已開始', 'success');
    setTimeout(hideStatus, 3000);
}


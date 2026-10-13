const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const SECRET_KEY_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const clientId = 'c_' + Math.random().toString(16).substring(2, 10);
const TOPIC_REQUEST = 'demotest/secure/request';
const TOPIC_RESPONSE = 'demotest/secure/response/' + clientId;

const fileInput = document.getElementById('image-upload');
const preview = document.getElementById('preview');
const icon = document.querySelector('.icon');
const explainBtn = document.getElementById('explain-btn') || document.getElementById('transcribe-btn');
const uploadView = document.getElementById('upload-view');
const loadingView = document.getElementById('loading-view');
const loadingStatus = document.getElementById('loading-status');
const resultView = document.getElementById('result-view');
const resultContent = document.getElementById('result-content');
const goBackBtn = document.getElementById('go-back-btn');

let selectedBase64 = null;
let sequenceTimeouts = [];
let timeoutTimer = null;
let isWaitingResponse = false;

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, len))
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getAesKey() {
  return await crypto.subtle.importKey(
    'raw',
    hexToBytes(SECRET_KEY_HEX),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptPayload(plainText) {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

async function decryptPayload(b64) {
  const bytes = base64ToBytes(b64);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const key = await getAesKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

const client = mqtt.connect(BROKER_URL, {
  clientId: clientId,
  clean: true
});

client.on('connect', () => {
  client.subscribe(TOPIC_RESPONSE);
});

if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 680;
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        selectedBase64 = canvas.toDataURL('image/jpeg', 0.6);
        if (preview) {
          preview.src = selectedBase64;
          preview.classList.remove('hidden');
        }
        if (icon) {
          icon.classList.add('hidden');
        }
        if (explainBtn) {
          explainBtn.disabled = false;
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearTimers() {
  sequenceTimeouts.forEach(clearTimeout);
  sequenceTimeouts = [];
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
}

function runProgressSequence() {
  if (!loadingStatus) return;
  loadingStatus.textContent = 'Sending image...';

  const delay1 = 1000 + Math.random() * 1000;
  const delay2 = delay1 + 1000 + Math.random() * 1000;
  const delay3 = delay2 + 1000 + Math.random() * 1000;

  sequenceTimeouts.push(
    setTimeout(() => {
      if (isWaitingResponse) {
        loadingStatus.textContent = 'Scanning image...';
      }
    }, delay1)
  );

  sequenceTimeouts.push(
    setTimeout(() => {
      if (isWaitingResponse) {
        loadingStatus.textContent = 'Describing image...';
      }
    }, delay2)
  );

  sequenceTimeouts.push(
    setTimeout(() => {
      if (isWaitingResponse) {
        loadingStatus.textContent = 'Generating explanation...';
      }
    }, delay3)
  );
}

if (explainBtn) {
  explainBtn.addEventListener('click', async () => {
    if (!selectedBase64) return;

    if (uploadView) uploadView.classList.add('hidden');
    if (resultView) resultView.classList.add('hidden');
    if (loadingView) loadingView.classList.remove('hidden');

    isWaitingResponse = true;
    clearTimers();
    runProgressSequence();

    timeoutTimer = setTimeout(() => {
      if (isWaitingResponse) {
        isWaitingResponse = false;
        clearTimers();
        showErrorState('error servers are busy');
      }
    }, 400000);

    const unencryptedJson = JSON.stringify({
      clientId: clientId,
      image: selectedBase64
    });

    const encryptedData = await encryptPayload(unencryptedJson);
    client.publish(TOPIC_REQUEST, encryptedData);
  });
}

client.on('message', async (topic, message) => {
  if (topic === TOPIC_RESPONSE && isWaitingResponse) {
    isWaitingResponse = false;
    clearTimers();

    try {
      const decryptedJson = await decryptPayload(message.toString());
      const data = JSON.parse(decryptedJson);
      showSuccessState(data.text || decryptedJson);
    } catch {
      showErrorState('error servers are busy');
    }
  }
});

function showSuccessState(rawText) {
  if (loadingView) loadingView.classList.add('hidden');
  if (resultContent) {
    resultContent.classList.remove('error-text');
    renderFormattedText(rawText);
  }
  if (resultView) resultView.classList.remove('hidden');
}

function showErrorState(errorMsg) {
  if (loadingView) loadingView.classList.add('hidden');
  if (resultContent) {
    resultContent.classList.add('error-text');
    resultContent.textContent = errorMsg;
  }
  if (resultView) resultView.classList.remove('hidden');
}

function renderFormattedText(rawText) {
  if (!resultContent) return;
  const formatted = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/"([^"]+)"/g, '&ldquo;$1&rdquo;')
    .replace(/\n/g, '<br>');

  resultContent.innerHTML = formatted;
}

if (goBackBtn) {
  goBackBtn.addEventListener('click', () => {
    clearTimers();
    isWaitingResponse = false;

    selectedBase64 = null;
    if (fileInput) fileInput.value = '';
    if (preview) {
      preview.src = '';
      preview.classList.add('hidden');
    }
    if (icon) icon.classList.remove('hidden');
    if (explainBtn) explainBtn.disabled = true;

    if (resultContent) {
      resultContent.innerHTML = '';
      resultContent.classList.remove('error-text');
    }

    if (loadingView) loadingView.classList.add('hidden');
    if (resultView) resultView.classList.add('hidden');
    if (uploadView) uploadView.classList.remove('hidden');
  });
}

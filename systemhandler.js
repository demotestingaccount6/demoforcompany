const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const SECRET_KEY_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const clientId = 'c_' + Math.random().toString(16).substring(2, 10);
const TOPIC_REQUEST = 'demotest/secure/request';
const TOPIC_RESPONSE = 'demotest/secure/response/' + clientId;

const fileInput = document.getElementById('image-upload');
const preview = document.getElementById('preview');
const icon = document.querySelector('.icon');
const transcribeBtn = document.getElementById('transcribe-btn');
const statusDiv = document.getElementById('status');
const resultDiv = document.getElementById('result');

let selectedBase64 = null;

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
  statusDiv.textContent = 'Connected (Encrypted)';
});

client.on('error', () => {
  statusDiv.textContent = 'Broker Error';
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 800;
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

      selectedBase64 = canvas.toDataURL('image/jpeg', 0.8);
      preview.src = selectedBase64;
      preview.classList.remove('hidden');
      icon.classList.add('hidden');
      transcribeBtn.disabled = false;
      statusDiv.textContent = 'Ready';
      resultDiv.classList.add('hidden');
      resultDiv.innerHTML = '';
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

transcribeBtn.addEventListener('click', async () => {
  if (!selectedBase64) return;

  transcribeBtn.disabled = true;
  statusDiv.textContent = 'Encrypting & Sending...';

  const unencryptedJson = JSON.stringify({
    clientId: clientId,
    image: selectedBase64
  });

  const encryptedData = await encryptPayload(unencryptedJson);
  client.publish(TOPIC_REQUEST, encryptedData);
});

client.on('message', async (topic, message) => {
  if (topic === TOPIC_RESPONSE) {
    try {
      const decryptedJson = await decryptPayload(message.toString());
      const data = JSON.parse(decryptedJson);
      renderFormattedText(data.text || decryptedJson);
    } catch {
      renderFormattedText('Decryption Failed');
    }
    statusDiv.textContent = '';
    transcribeBtn.disabled = false;
  }
});

function renderFormattedText(rawText) {
  const formatted = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/"([^"]+)"/g, '&ldquo;$1&rdquo;')
    .replace(/\n/g, '<br>');

  resultDiv.innerHTML = formatted;
  resultDiv.classList.remove('hidden');
}

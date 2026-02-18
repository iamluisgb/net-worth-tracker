// Google Drive backup/restore via GIS implicit flow + REST API

const CLIENT_ID = '146475241021-2sschmrutnqdeug5fo6onc772im94ltt.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const BACKUP_FILENAME = 'net-worth-tracker-backup.json';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

const TOKEN_KEY = 'nwtToken';
const EXPIRY_KEY = 'nwtTokenExpiry';

function persistToken() {
  try {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(EXPIRY_KEY, tokenExpiry.toString());
  } catch { /* localStorage full or unavailable */ }
}

export function clearStoredToken() {
  accessToken = null;
  tokenExpiry = 0;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

function restoreToken() {
  const t = localStorage.getItem(TOKEN_KEY);
  const e = parseInt(localStorage.getItem(EXPIRY_KEY)) || 0;
  if (t && Date.now() < e) {
    accessToken = t;
    tokenExpiry = e;
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  }
}

export function initDrive() {
  restoreToken();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {},
  });
}

export function hasValidToken() {
  return accessToken && Date.now() < tokenExpiry;
}

function ensureAuth() {
  return new Promise((resolve, reject) => {
    if (hasValidToken()) {
      resolve(accessToken);
      return;
    }
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }
      accessToken = response.access_token;
      tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;
      persistToken();
      resolve(accessToken);
    };
    tokenClient.requestAccessToken();
  });
}

async function driveFetch(res, context) {
  if (res.ok) return res;
  if (res.status === 401) {
    clearStoredToken();
    throw new Error('token_expired');
  }
  throw new Error(`${context}: ${res.status}`);
}

async function findBackupFile(token) {
  const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,modifiedTime)',
    q: `name='${BACKUP_FILENAME}'`,
    pageSize: '1',
  });
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  await driveFetch(res, 'Error al buscar backup');
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function uploadFile(token, content, existingFileId) {
  const metadata = existingFileId
    ? { name: BACKUP_FILENAME }
    : { name: BACKUP_FILENAME, parents: ['appDataFolder'] };

  const boundary = '---nwt_boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  await driveFetch(res, 'Error al subir backup');
  return res.json();
}

async function downloadFile(token, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  await driveFetch(res, 'Error al descargar backup');
  return res.text();
}

export async function backupToDrive(db) {
  const token = await ensureAuth();
  const content = JSON.stringify(db, null, 2);
  const existing = await findBackupFile(token);
  await uploadFile(token, content, existing ? existing.id : null);
  return { success: true, updated: !!existing };
}

export async function restoreFromDrive() {
  const token = await ensureAuth();
  const file = await findBackupFile(token);
  if (!file) return { success: false, reason: 'no_backup' };
  const content = await downloadFile(token, file.id);
  const data = JSON.parse(content);
  if (!data.assets || !data.transactions) throw new Error('Formato de backup no válido');
  return { success: true, data, modifiedTime: file.modifiedTime };
}

// === Auto-sync ===

const SYNC_TS_KEY = 'nwtLastSync';

function getLocalSyncTime() {
  return parseInt(localStorage.getItem(SYNC_TS_KEY)) || 0;
}

function setLocalSyncTime() {
  localStorage.setItem(SYNC_TS_KEY, Date.now().toString());
}

let _syncing = false;
export function isSyncing() { return _syncing; }

export async function silentBackup(db) {
  if (_syncing || !hasValidToken()) return;
  try {
    _syncing = true;
    await backupToDrive(db);
    setLocalSyncTime();
    setSyncStatus('ok');
  } catch {
    setSyncStatus('error');
  } finally {
    _syncing = false;
  }
}

export async function syncOnLoad(db, saveFn) {
  if (!hasValidToken()) return;
  try {
    _syncing = true;
    setSyncStatus('syncing');
    const file = await findBackupFile(accessToken);
    if (!file) {
      _syncing = false;
      await silentBackup(db);
      return;
    }
    const driveTime = new Date(file.modifiedTime).getTime();
    const localTime = getLocalSyncTime();
    if (driveTime > localTime) {
      const content = await downloadFile(accessToken, file.id);
      const data = JSON.parse(content);
      if (data.assets && data.transactions) {
        saveFn(data);
        setLocalSyncTime();
        setSyncStatus('ok');
        _syncing = false;
        location.reload();
        return;
      }
    }
    _syncing = false;
    await silentBackup(db);
  } catch {
    setSyncStatus('error');
    _syncing = false;
  }
}

let _syncStatusCb = null;
export function onSyncStatus(cb) { _syncStatusCb = cb; }
function setSyncStatus(status) { if (_syncStatusCb) _syncStatusCb(status); }

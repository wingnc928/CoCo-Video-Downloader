const SERVER = 'http://127.0.0.1:18080';

document.addEventListener('DOMContentLoaded', async () => {
  const dirInput = document.getElementById('download-dir');
  const formatSel = document.getElementById('default-format');
  const saveBtn = document.getElementById('save-btn');
  const savedMsg = document.getElementById('saved-msg');
  const browseBtn = document.getElementById('browse-btn');

  try {
    const resp = await fetch(SERVER + '/settings', {mode: 'cors'});
    if (resp.ok) {
      const settings = await resp.json();
      dirInput.value = settings.download_dir || '';
      formatSel.value = settings.format || 'best';
    }
  } catch (e) {
    console.error('Could not load settings from server', e);
    dirInput.placeholder = 'Server offline - start Start_Server.bat first';
  }

  browseBtn.addEventListener('click', async () => {
    browseBtn.disabled = true;
    const oldText = browseBtn.textContent;
    browseBtn.textContent = '选择中...';
    try {
      const resp = await fetch(SERVER + '/select_folder', {method: 'POST', mode: 'cors'});
      if (resp.ok) {
        const res = await resp.json();
        if (res.status === 'success' && res.folder) {
          dirInput.value = res.folder;
        }
      } else {
        alert('无法打开文件夹选择器：服务器响应失败。');
      }
    } catch (e) {
      console.error(e);
      alert('无法打开文件夹选择器。请检查后台服务是否已启动（Start_Server.bat）。');
    } finally {
      browseBtn.disabled = false;
      browseBtn.textContent = oldText;
    }
  });

  saveBtn.addEventListener('click', async () => {
    try {
      const resp = await fetch(SERVER + '/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          download_dir: dirInput.value,
          format: formatSel.value
        })
      });

      if (resp.ok) {
        savedMsg.style.display = 'inline';
        setTimeout(() => savedMsg.style.display = 'none', 2500);
      } else {
        throw new Error('Server returned ' + resp.status);
      }
    } catch (e) {
      alert(`Error saving settings. Is the server running?

Start Start_Server.bat and try again.`);
    }
  });
});

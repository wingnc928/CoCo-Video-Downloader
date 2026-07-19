chrome.runtime.onInstalled.addListener(() => {
  console.log('CoCo-Video-Downloader Extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, {action: "download"});
});

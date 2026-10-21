// Pure evidence classification shared by the real-browser exercise and focused tests.
export function readerSettled(text) {
 return /^(Showing posts authorized|No accessible posts\.)/.test(text || '');
}
export function classifyWorkerUpgrade({hadActiveWorker,workerReplaced,controllerChanged,newCachePresent,obsoleteCachesRemaining}) {
 const activation_verified=newCachePresent && !obsoleteCachesRemaining;
 return {activation_verified,upgrade_verified:activation_verified && hadActiveWorker && workerReplaced && controllerChanged};
}

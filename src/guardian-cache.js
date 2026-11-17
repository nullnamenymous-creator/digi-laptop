export function clearCashierCache(storage, userId, organizationId) {
  const keys = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    const session = key === 'digi-offline-session:' + userId;
    const cashier = key?.startsWith('digi-offline-cashier:' + organizationId + ':');
    if (session || cashier) keys.push(key);
  }
  keys.forEach(key => storage.removeItem(key));
}

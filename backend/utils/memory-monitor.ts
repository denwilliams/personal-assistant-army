/**
 * Memory monitoring utility for debugging Heroku memory issues
 */

export function startMemoryMonitor(intervalMs: number = 1000) {
  const formatBytes = (bytes: number) => {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const logMemory = () => {
    const usage = process.memoryUsage();
    console.log('Memory Usage: %j', {
      rss: formatBytes(usage.rss),           // Total memory allocated
      heapTotal: formatBytes(usage.heapTotal), // Total heap
      heapUsed: formatBytes(usage.heapUsed),   // Used heap
      external: formatBytes(usage.external),   // C++ objects bound to JS
    });
  };

  // Log immediately
  logMemory();

  // Log every interval
  const interval = setInterval(logMemory, intervalMs);

  return () => clearInterval(interval);
}

export function logMemorySnapshot(label: string) {
  const usage = process.memoryUsage();
  const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  console.log(`[${label}] Memory: %j`, {
    rss: formatBytes(usage.rss),
    heapUsed: formatBytes(usage.heapUsed),
  });
}

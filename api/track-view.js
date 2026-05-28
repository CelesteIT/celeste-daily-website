export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const data = {
    page: req.body?.page || '',
    title: req.body?.title || '',
    url: req.body?.url || '',
    referrer: req.body?.referrer || 'direct',
    screen: req.body?.screen || '',
    language: req.body?.language || '',
    platform: req.body?.platform || '',
    timestamp: req.body?.timestamp || new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || '',
    userAgent: req.headers['user-agent'] || ''
  };

  console.log('PAGE_VIEW:', JSON.stringify(data, null, 2));

  return res.status(200).json({ success: true });
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const token = Netlify.env.get('MONDAY_API_TOKEN');
  const body  = await req.text();
  const resp  = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': token,
      'API-Version':   '2024-01' 
    },
    body
  });
  const data = await resp.text();
  return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json', ...corsHeaders() }});
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export const config = { path: '/api/monday' };
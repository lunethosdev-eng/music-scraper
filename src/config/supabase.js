const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ajbmpgnzkgtcmulocftd.supabase.co';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqYm1wZ256a2d0Y211bG9jZnRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM0NTYyOSwiZXhwIjoyMTA1OTIxNjI5fQ.JIw6EUefVcnQ7-P8-lRg__bAhEJvjcQYGFfaXpk9Vik';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

module.exports = { supabase, SUPABASE_URL };

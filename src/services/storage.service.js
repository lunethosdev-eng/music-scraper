const fs = require('fs');
const { supabase } = require('../config/supabase');

async function uploadFileToSupabase(bucketName, filePath, destinationFileName, mimeType) {
  const fileBuffer = fs.readFileSync(filePath);

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(destinationFileName, fileBuffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) throw error;

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(destinationFileName);

  return publicUrlData.publicUrl;
}

module.exports = { uploadFileToSupabase };

' ROKU BRIGHTSCRIPT OFFLINE MUSIC PLAYER COMPONENT

sub DownloadAndPlayOffline(trackUrl as String, trackId as String)
    localMp3Path = "tmp:/" + trackId + ".mp3"
    
    ' 1. Transferencia mediante roUrlTransfer para buffering local
    xfer = CreateObject("roUrlTransfer")
    xfer.SetUrl(trackUrl)
    xfer.GetToFile(localMp3Path)
    
    ' 2. Configurar Reproductor de Audio utilizando la ruta en tmp:/
    audioPlayer = CreateObject("roAudioPlayer")
    content = CreateObject("roAssociativeArray")
    content.Url = localMp3Path
    content.StreamFormat = "mp3"
    
    audioPlayer.AddContent(content)
    audioPlayer.Play()
end sub

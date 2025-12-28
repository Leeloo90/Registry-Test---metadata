import { MediaFile } from '../types';

export const useXMLExporter = () => {
  
  const generateXML = (files: MediaFile[], sequenceName: string = "StoryGraph_Sync") => {
    // 1. DETECT PROJECT FPS
    // We look for the first video file with tech specs to set the timeline speed.
    // Fallback to 25 if none found.
    const firstVideo = files.find(f => f.media_category === 'video' && f.tech_metadata?.frame_rate_fraction);
    const rawFPS = firstVideo?.tech_metadata?.frame_rate_fraction || "25";
    
    // Premiere/FCP XML standards: 59.94 is written as 60 timebase with NTSC TRUE
    const FPS_NUM = parseFloat(rawFPS);
    const TIMEBASE = Math.round(FPS_NUM);
    const IS_NTSC = FPS_NUM % 1 !== 0 ? "TRUE" : "FALSE";
    
    // Standard Start at 01:00:00:00
    const timelineStartFrame = 3600 * TIMEBASE; 

    // PATH CONFIGURATION
    const LOCAL_ROOT = "/Users/lelanie/Library/CloudStorage/GoogleDrive-ambientartsza@gmail.com/My Drive/";
    const pathPrefix = `file://${LOCAL_ROOT}`;

    const getSafeDuration = (file: MediaFile) => {
      // Use total_frames from MediaInfo if available
      if (file.tech_metadata?.total_frames) {
        return parseInt(file.tech_metadata.total_frames, 10);
      }
      // Fallback: Duration / 1000 * FPS
      if (file.duration && file.duration > 0) return Math.round((file.duration / 1000) * FPS_NUM);
      return 100; // Minimum safety
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
<sequence>
<name>${sequenceName}</name>
<rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
<in>-1</in><out>-1</out>
<timecode>
<string>01:00:00:00</string>
<frame>${timelineStartFrame}</frame>
<displayformat>NDF</displayformat>
<rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
</timecode>
<media>
<video>`;

    const videoAngles = files.filter(f => f.media_category === 'video' && f.clip_type === 'interview');
    const masterAudio = files.filter(f => f.media_category === 'audio' && f.clip_type === 'interview');

    // VIDEO TRACKS
    videoAngles.forEach((file) => {
      const duration = getSafeDuration(file);
      const start = file.sync_offset_frames || 0;
      const end = start + duration;
      
      const fullPath = file.relative_path 
        ? `${pathPrefix}${file.relative_path}/${encodeURIComponent(file.filename)}`
        : `${pathPrefix}${encodeURIComponent(file.filename)}`;

      const hasTech = !!file.tech_metadata;

      xml += `
        <track>
            <clipitem id="${file.filename} 0">
                <name>${file.filename}</name>
                <duration>${duration}</duration>
                <rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
                <start>${start}</start>
                <end>${end}</end>
                <enabled>TRUE</enabled>
                <in>0</in>
                <out>${duration}</out>
                <file id="${file.filename} 2">
                    <name>${file.filename}</name>
                    <pathurl>${fullPath}</pathurl>
                    <rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
                    ${hasTech ? `
                    <timecode>
                        <string>${file.tech_metadata!.start_tc}</string>
                        <displayformat>NDF</displayformat>
                        <rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
                    </timecode>
                    ` : ''} 
                    <media>
                        <video>
                            <samplecharacteristics>
                                <width>${hasTech ? file.tech_metadata!.width : 1920}</width>
                                <height>${hasTech ? file.tech_metadata!.height : 1080}</height>
                                <rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
                            </samplecharacteristics>
                        </video>
                        <audio><channelcount>2</channelcount></audio>
                    </media>
                </file>
                <link><linkclipref>${file.filename} 0</linkclipref></link>
                <link><linkclipref>${file.filename} 3</linkclipref></link>
            </clipitem>
        </track>`;
    });

    xml += `<format><samplecharacteristics><width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio><rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate></samplecharacteristics></format></video><audio>`;

    // INTERNAL AUDIO TRACKS (Camera Scratch)
    videoAngles.forEach((file) => {
      const duration = getSafeDuration(file);
      const start = file.sync_offset_frames || 0;

      xml += `
        <track>
            <clipitem id="${file.filename} 3">
                <name>${file.filename}</name>
                <duration>${duration}</duration>
                <rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
                <start>${start}</start>
                <end>${start + duration}</end>
                <enabled>TRUE</enabled>
                <in>0</in><out>${duration}</out>
                <file id="${file.filename} 2"/>
                <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
                <link><linkclipref>${file.filename} 0</linkclipref></link>
                <link><linkclipref>${file.filename} 3</linkclipref></link>
            </clipitem>
        </track>`;
    });

    // MASTER AUDIO TRACK (Field Recorder)
    masterAudio.forEach((file) => {
      const duration = getSafeDuration(file);
      const fullPath = file.relative_path 
        ? `${pathPrefix}${file.relative_path}/${encodeURIComponent(file.filename)}`
        : `${pathPrefix}${encodeURIComponent(file.filename)}`;

      xml += `
        <track>
            <clipitem id="${file.filename} 3">
                <name>${file.filename}</name>
                <duration>${duration}</duration>
                <rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
                <start>0</start>
                <end>${duration}</end>
                <enabled>TRUE</enabled>
                <in>0</in><out>${duration}</out>
                <file id="${file.filename} 1">
                    <name>${file.filename}</name>
                    <pathurl>${fullPath}</pathurl>
                    <rate><timebase>${TIMEBASE}</timebase><ntsc>${IS_NTSC}</ntsc></rate>
                </file>
                <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
            </clipitem>
        </track>`;
    });

    xml += `</audio></media></sequence></xmeml>`;
    return xml;
  };

  const downloadXML = (xmlContent: string, filename: string = "StoryGraph_Final_Sync.xml") => {
    const blob = new Blob([xmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return { generateXML, downloadXML };
};
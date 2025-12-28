import { MediaFile } from '../types';

export const useXMLExporter = () => {
  
  const generateXML = (files: MediaFile[], sequenceName: string = "StoryGraph_Multicam_Sync") => {
    // Detect the actual frame rate from the first video file
    const firstVideo = files.find(f => f.media_category === 'video' && f.tech_metadata?.frame_rate_fraction);
    let TIMELINE_FPS = 25;
    let IS_NTSC = false;
    
    if (firstVideo?.tech_metadata?.frame_rate_fraction) {
      const fpsString = firstVideo.tech_metadata.frame_rate_fraction;
      let fpsValue = 25;
      
      if (fpsString.includes('/')) {
        const [num, den] = fpsString.split('/').map(Number);
        fpsValue = num / den;
      } else {
        fpsValue = parseFloat(fpsString);
      }
      
      TIMELINE_FPS = Math.round(fpsValue);
      IS_NTSC = (fpsValue % 1 !== 0);
    }
    
    const timelineStartFrame = 3600 * TIMELINE_FPS; // 01:00:00:00

    const LOCAL_ROOT = "/Users/lelanie/Library/CloudStorage/GoogleDrive-ambientartsza@gmail.com/My Drive/";
    const pathPrefix = `file://${LOCAL_ROOT}`;

    const videoAngles = files.filter(f => f.clip_type === 'interview' && f.media_category === 'video');
    const masterAudio = files.filter(f => f.clip_type === 'interview' && f.media_category === 'audio');

    const getSafeDuration = (file: MediaFile) => {
      console.log(`[Duration Check] ${file.filename}:`, {
        total_frames: file.tech_metadata?.total_frames,
        duration_ms: file.duration,
        fps: file.tech_metadata?.frame_rate_fraction
      });

      // Method 1: Use total_frames if available and non-zero
      if (file.tech_metadata?.total_frames) {
        const totalFrames = parseInt(file.tech_metadata.total_frames, 10);
        if (totalFrames > 0) {
          // Get native FPS
          let nativeFPS = 25;
          const fpsStr = file.tech_metadata.frame_rate_fraction || "25";
          if (fpsStr.includes('/')) {
            const [num, den] = fpsStr.split('/').map(Number);
            nativeFPS = num / den;
          } else {
            nativeFPS = parseFloat(fpsStr);
          }
          
          // Convert to timeline FPS
          const timelineDuration = Math.round((totalFrames / nativeFPS) * TIMELINE_FPS);
          console.log(`  → Using total_frames: ${totalFrames} @ ${nativeFPS}fps = ${timelineDuration} frames @ ${TIMELINE_FPS}fps`);
          return timelineDuration;
        }
      }
      
      // Method 2: Calculate from duration in milliseconds
      if (file.duration && file.duration > 0) {
        const durationFrames = Math.round((file.duration / 1000) * TIMELINE_FPS);
        console.log(`  → Using duration_ms: ${file.duration}ms = ${durationFrames} frames @ ${TIMELINE_FPS}fps`);
        return durationFrames;
      }
      
      // Method 3: Fallback - 10 seconds
      console.warn(`  → WARNING: No valid duration found, using 250 frame fallback`);
      return 250;
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
    <sequence>
        <name>${sequenceName}</name>
        <duration>${timelineStartFrame + 10000}</duration>
        <rate>
            <timebase>${TIMELINE_FPS}</timebase>
            <ntsc>${IS_NTSC ? 'TRUE' : 'FALSE'}</ntsc>
        </rate>
        <in>-1</in>
        <out>-1</out>
        <timecode>
            <string>01:00:00:00</string>
            <frame>${timelineStartFrame}</frame>
            <displayformat>${IS_NTSC ? 'DF' : 'NDF'}</displayformat>
            <rate>
                <timebase>${TIMELINE_FPS}</timebase>
                <ntsc>${IS_NTSC ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
        </timecode>
        <media>
            <video>`;

    // VIDEO TRACKS
    videoAngles.forEach((file, idx) => {
      const duration = getSafeDuration(file);
      const start = file.sync_offset_frames || 0;
      const end = start + duration;
      
      const fullPath = file.relative_path 
        ? `${pathPrefix}${file.relative_path}/${encodeURIComponent(file.filename)}`
        : `${pathPrefix}${encodeURIComponent(file.filename)}`;

      const cleanId = file.filename.replace(/[^a-zA-Z0-9]/g, '');
      const hasTech = !!file.tech_metadata;
      
      // Get native file FPS
      let nativeFPS = TIMELINE_FPS;
      let nativeFrameCount = duration;
      
      if (hasTech && file.tech_metadata!.frame_rate_fraction) {
        const fpsStr = file.tech_metadata!.frame_rate_fraction;
        if (fpsStr.includes('/')) {
          const [num, den] = fpsStr.split('/').map(Number);
          nativeFPS = Math.round(num / den);
        } else {
          nativeFPS = Math.round(parseFloat(fpsStr));
        }
        
        // Use native frame count if available
        if (file.tech_metadata!.total_frames) {
          const frames = parseInt(file.tech_metadata!.total_frames, 10);
          if (frames > 0) nativeFrameCount = frames;
        }
      }

      xml += `
                <track>
                    <clipitem id="${cleanId} ${idx}">
                        <name>${file.filename}</name>
                        <duration>${duration}</duration>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>${IS_NTSC ? 'TRUE' : 'FALSE'}</ntsc>
                        </rate>
                        <start>${start}</start>
                        <end>${end}</end>
                        <enabled>TRUE</enabled>
                        <in>0</in>
                        <out>${duration}</out>
                        <file id="${cleanId} 2">
                            <duration>${nativeFrameCount}</duration>
                            <rate>
                                <timebase>${nativeFPS}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <name>${file.filename}</name>
                            <pathurl>${fullPath}</pathurl>
                            ${hasTech && file.tech_metadata!.start_tc ? `<timecode>
                                <string>${file.tech_metadata!.start_tc}</string>
                                <displayformat>${IS_NTSC ? 'DF' : 'NDF'}</displayformat>
                                <rate>
                                    <timebase>${nativeFPS}</timebase>
                                    <ntsc>FALSE</ntsc>
                                </rate>
                            </timecode>` : ''}
                            <media>
                                <video>
                                    <duration>${nativeFrameCount}</duration>
                                    <samplecharacteristics>
                                        <width>${hasTech && file.tech_metadata!.width ? file.tech_metadata!.width : 1920}</width>
                                        <height>${hasTech && file.tech_metadata!.height ? file.tech_metadata!.height : 1080}</height>
                                    </samplecharacteristics>
                                </video>
                                <audio>
                                    <channelcount>2</channelcount>
                                </audio>
                            </media>
                        </file>
                        <link>
                            <linkclipref>${cleanId} ${idx}</linkclipref>
                        </link>
                        <link>
                            <linkclipref>${cleanId} 3</linkclipref>
                        </link>
                        <comments/>
                    </clipitem>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
                </track>`;
    });

    xml += `
                <format>
                    <samplecharacteristics>
                        <width>1920</width>
                        <height>1080</height>
                        <pixelaspectratio>square</pixelaspectratio>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>${IS_NTSC ? 'TRUE' : 'FALSE'}</ntsc>
                        </rate>
                    </samplecharacteristics>
                </format>
            </video>
            <audio>`;

    // CAMERA SCRATCH AUDIO
    videoAngles.forEach((file, idx) => {
      const duration = getSafeDuration(file);
      const start = file.sync_offset_frames || 0;
      const end = start + duration;
      const cleanId = file.filename.replace(/[^a-zA-Z0-9]/g, '');

      xml += `
                <track>
                    <clipitem id="${cleanId} 3">
                        <name>${file.filename}</name>
                        <duration>${duration}</duration>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>${IS_NTSC ? 'TRUE' : 'FALSE'}</ntsc>
                        </rate>
                        <start>${start}</start>
                        <end>${end}</end>
                        <enabled>TRUE</enabled>
                        <in>0</in>
                        <out>${duration}</out>
                        <file id="${cleanId} 2"/>
                        <sourcetrack>
                            <mediatype>audio</mediatype>
                            <trackindex>1</trackindex>
                        </sourcetrack>
                        <link>
                            <linkclipref>${cleanId} ${idx}</linkclipref>
                            <mediatype>video</mediatype>
                        </link>
                        <link>
                            <linkclipref>${cleanId} 3</linkclipref>
                        </link>
                        <comments/>
                    </clipitem>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
                </track>`;
    });

    // MASTER AUDIO TRACK
    masterAudio.forEach((file, idx) => {
      const duration = getSafeDuration(file);
      const fullPath = file.relative_path 
        ? `${pathPrefix}${file.relative_path}/${encodeURIComponent(file.filename)}`
        : `${pathPrefix}${encodeURIComponent(file.filename)}`;
      
      const cleanId = file.filename.replace(/[^a-zA-Z0-9]/g, '');

      xml += `
                <track>
                    <clipitem id="${cleanId} 0">
                        <name>${file.filename}</name>
                        <duration>${duration}</duration>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>${IS_NTSC ? 'TRUE' : 'FALSE'}</ntsc>
                        </rate>
                        <start>0</start>
                        <end>${duration}</end>
                        <enabled>TRUE</enabled>
                        <in>0</in>
                        <out>${duration}</out>
                        <file id="${cleanId} 1">
                            <duration>${duration}</duration>
                            <rate>
                                <timebase>${TIMELINE_FPS}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <name>${file.filename}</name>
                            <pathurl>${fullPath}</pathurl>
                            <media>
                                <audio>
                                    <channelcount>2</channelcount>
                                </audio>
                            </media>
                        </file>
                        <sourcetrack>
                            <mediatype>audio</mediatype>
                            <trackindex>1</trackindex>
                        </sourcetrack>
                        <comments/>
                    </clipitem>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
                </track>`;
    });

    xml += `
            </audio>
        </media>
    </sequence>
</xmeml>`;

    console.log(`[XML Export] Complete: ${videoAngles.length} video + ${masterAudio.length} audio tracks`);
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
    console.log(`[XML Export] Downloaded: ${filename}`);
  };

  return { generateXML, downloadXML };
};
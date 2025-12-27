import { MediaFile } from '../types';

export const useXMLExporter = () => {
  
  const generateXML = (files: MediaFile[], sequenceName: string = "StoryGraph_Sync") => {
    const FPS = 25; 
    const timelineStartFrame = 90000; 

    // PATH CONFIGURATION
    const LOCAL_ROOT = "/Users/lelanie/Library/CloudStorage/GoogleDrive-ambientartsza@gmail.com/My Drive/";
    const pathPrefix = `file://${LOCAL_ROOT}`;

    const getSafeDuration = (file: MediaFile) => {
      // PRIORITY 1: Use Exact Frame Count from Tech Pass
      if (file.tech_metadata?.total_frames) {
        return parseInt(file.tech_metadata.total_frames, 10);
      }
      
      // Fallback: Calculate from milliseconds (Less precise)
      if (file.duration && file.duration > 0) return Math.round((file.duration / 1000) * FPS);
      return Math.max(Math.round((file.size_bytes / 176400) * FPS), 25); 
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
<sequence>
<name>${sequenceName}</name>
<rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
<in>-1</in><out>-1</out>
<timecode>
<string>01:00:00:00</string>
<frame>${timelineStartFrame}</frame>
<displayformat>NDF</displayformat>
<rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
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
      
      // Path Logic: Combine Root + Relative Path (if exists) + Filename
      const fullPath = file.relative_path 
        ? `${pathPrefix}${file.relative_path}/${encodeURIComponent(file.filename)}`
        : `${pathPrefix}${encodeURIComponent(file.filename)}`;

      // LOGIC BRANCH: Do we have the Truth?
      const hasTech = !!file.tech_metadata;

      xml += `
        <track>
            <clipitem id="${file.filename} 0">
                <name>${file.filename}</name>
                <duration>${duration}</duration>
                <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
                <start>${start}</start>
                <end>${end}</end>
                <enabled>TRUE</enabled>
                <in>0</in>
                <out>${duration}</out>
                <file id="${file.filename} 2">
                    <name>${file.filename}</name>
                    <pathurl>${fullPath}</pathurl>
                    
                    ${hasTech ? `
                    <timecode>
                        <string>${file.tech_metadata!.start_tc}</string>
                        <displayformat>NDF</displayformat>
                        <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
                    </timecode>
                    ` : ''} 
                    
                    <media>
                        <video>
                            <samplecharacteristics>
                                <width>${hasTech ? file.tech_metadata!.width : 1920}</width>
                                <height>${hasTech ? file.tech_metadata!.height : 1080}</height>
                            </samplecharacteristics>
                        </video>
                        <audio><channelcount>2</channelcount></audio>
                    </media>
                </file>
                <compositemode>normal</compositemode>
                <filter>
                    <enabled>TRUE</enabled><start>0</start><end>${duration}</end>
                    <effect>
                        <name>Basic Motion</name><effectid>basic</effectid><effecttype>motion</effecttype><mediatype>video</mediatype><effectcategory>motion</effectcategory>
                        <parameter><name>Scale</name><parameterid>scale</parameterid><value>100</value><valuemin>0</valuemin><valuemax>10000</valuemax></parameter>
                        <parameter><name>Center</name><parameterid>center</parameterid><value><horiz>0</horiz><vert>0</vert></value></parameter>
                        <parameter><name>Rotation</name><parameterid>rotation</parameterid><value>0</value><valuemin>-100000</valuemin><valuemax>100000</valuemax></parameter>
                        <parameter><name>Anchor Point</name><parameterid>centerOffset</parameterid><value><horiz>0</horiz><vert>0</vert></value></parameter>
                    </effect>
                </filter>
                <filter>
                    <enabled>TRUE</enabled><start>0</start><end>${duration}</end>
                    <effect>
                        <name>Opacity</name><effectid>opacity</effectid><effecttype>motion</effecttype><mediatype>video</mediatype><effectcategory>motion</effectcategory>
                        <parameter><name>opacity</name><parameterid>opacity</parameterid><value>100</value><valuemin>0</valuemin><valuemax>100</valuemax></parameter>
                    </effect>
                </filter>
                <link><linkclipref>${file.filename} 0</linkclipref></link>
                <link><linkclipref>${file.filename} 3</linkclipref></link>
            </clipitem>
        </track>`;
    });

    xml += `<format><samplecharacteristics><width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio><rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate></samplecharacteristics></format></video><audio>`;

    // INTERNAL AUDIO
    videoAngles.forEach((file) => {
      const duration = getSafeDuration(file);
      const start = file.sync_offset_frames || 0;

      xml += `
        <track>
            <clipitem id="${file.filename} 3">
                <name>${file.filename}</name>
                <duration>${duration}</duration>
                <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
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

    // MASTER AUDIO
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
                <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
                <start>0</start>
                <end>${duration}</end>
                <enabled>TRUE</enabled>
                <in>0</in><out>${duration}</out>
                <file id="${file.filename} 1">
                    <name>${file.filename}</name>
                    <pathurl>${fullPath}</pathurl>
                    <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
                    <duration>${duration}</duration>
                </file>
                <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
            </clipitem>
        </track>`;
    });

    xml += `</audio></media></sequence></xmeml>`;
    return xml;
  };

  const downloadXML = (xmlContent: string, filename: string = "StoryGraph_Sync.xml") => {
    const blob = new Blob([xmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return { generateXML, downloadXML };
};
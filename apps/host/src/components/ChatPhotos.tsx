import { tr } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { photoData, type ChatPhoto } from '../lib/chat-photos';

/** The draft-attachment rail (the DeepSeek look, adapted to Strata's data flow): horizontal
 * thumbnail cards, each with the file name under it and the remove control revealed on hover,
 * single-click opens the full image in a new tab. Rendered at the top inside the composer, so
 * a dropped or attached file is always visible before the message goes out. */
export function ChatPhotos({ photos, onRemove }: {
    photos: ChatPhoto[];
    onRemove?: (id: string) => void;
}) {
    const [images, setImages] = useState<{
        id: string;
        name: string;
        url: string;
    }[]>([]);
    useEffect(() => {
        let current = true;
        void Promise.all(photos.map(async (photo) => ({ ...await photoData(photo), id: photo.id }))).then(value => {
            if (current)
                setImages(value);
        }).catch(() => {
            if (current)
                setImages([]);
        });
        return () => { current = false; };
    }, [photos]);
    return <div className="chat-photos" role="list">{tr(images.map(i => <div className="chat-photo-card" role="listitem" key={i.id}>
        <a className="chat-photo-card__img" href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt={i.name} loading="lazy"/></a>
        <span className="chat-photo-card__name" title={i.name}>{i.name}</span>
        {tr(onRemove ? <button type="button" className="chat-photo-card__x" aria-label={tr("Remove {0}", [i.name])} title={tr("Remove {0}", [i.name])} onClick={() => onRemove(i.id)}>✕</button> : null)}
    </div>))}</div>;
}

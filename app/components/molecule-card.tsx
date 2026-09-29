import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { normalizeDegrees, resizeCursor } from "../lib/geometry";
import type { MoleculeItem, ResizeDirection } from "../lib/types";

const RESIZE_DIRECTIONS: ResizeDirection[] = ["nw", "ne", "sw", "se"];

type MoleculeCardProps = {
  molecule: MoleculeItem;
  isSelected: boolean;
  onDragStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    molecule: MoleculeItem,
  ) => void;
  onResizeStart: (
    event: ReactPointerEvent<HTMLSpanElement>,
    molecule: MoleculeItem,
    direction: ResizeDirection,
  ) => void;
  onRotationStart: (
    event: ReactPointerEvent<HTMLSpanElement>,
    molecule: MoleculeItem,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (pointerId: number) => void;
  onRotate: (id: string, rotation: number) => void;
  onFlip: (id: string, direction: "horizontal" | "vertical") => void;
  onToggleStereoLabels: (id: string) => void;
  onCopy: (smiles: string) => void;
  onRemove: (id: string) => void;
};

export function MoleculeCard({
  molecule,
  isSelected,
  onDragStart,
  onResizeStart,
  onRotationStart,
  onPointerMove,
  onPointerEnd,
  onRotate,
  onFlip,
  onToggleStereoLabels,
  onCopy,
  onRemove,
}: MoleculeCardProps) {
  const displayedRotation = normalizeDegrees(molecule.rotation);
  // Keep the toolbar and label clear of the rotated frame's vertical extent.
  const radians = (molecule.rotation * Math.PI) / 180;
  const rotatedHeight =
    Math.abs(molecule.width * Math.sin(radians)) +
    Math.abs(molecule.height * Math.cos(radians));
  const toolbarTop = (molecule.height - rotatedHeight) / 2 - 48;
  const labelTop = (molecule.height + rotatedHeight) / 2 + 10;

  const rotateWithKeyboard = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : 0;
    if (!direction && event.key !== "Home") return;
    event.preventDefault();
    onRotate(
      molecule.id,
      event.key === "Home" ? 0 : molecule.rotation + direction * 15,
    );
  };

  const endPointer = (event: ReactPointerEvent) => onPointerEnd(event.pointerId);

  return (
    <div
      className={`molecule-item${isSelected ? " is-selected" : ""}`}
      style={{
        left: molecule.x,
        top: molecule.y,
        width: molecule.width,
        height: molecule.height,
        zIndex: molecule.zIndex,
      }}
      role="group"
      aria-label={`Molecule ${molecule.canonicalSmiles}`}
      aria-keyshortcuts="Meta+C Control+C"
      onPointerDown={(event) => onDragStart(event, molecule)}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
    >
      <div
        className="molecule-transform"
        style={{ transform: `rotate(${molecule.rotation}deg)` }}
      >
        <div
          className="molecule-art"
          style={{
            transform: `scale(${molecule.flippedHorizontally ? -1 : 1}, ${molecule.flippedVertically ? -1 : 1})`,
          }}
        >
          <div
            className="molecule-svg"
            dangerouslySetInnerHTML={{ __html: molecule.svg }}
          />
        </div>

        {isSelected && (
          <>
            {RESIZE_DIRECTIONS.map((direction) => (
              <span
                className={`resize-handle resize-handle--${direction}`}
                key={direction}
                role="presentation"
                style={{ cursor: resizeCursor(direction, molecule.rotation) }}
                onPointerDown={(event) =>
                  onResizeStart(event, molecule, direction)
                }
                onLostPointerCapture={endPointer}
              />
            ))}
            <span
              className="rotation-handle"
              role="presentation"
              aria-hidden="true"
              title="Drag to rotate · hold Shift to snap"
              onPointerDown={(event) => onRotationStart(event, molecule)}
              onLostPointerCapture={endPointer}
            />
          </>
        )}
      </div>

      {isSelected && (
        <>
          <div
            className="selection-toolbar"
            role="toolbar"
            aria-label="Molecule controls"
            style={{ top: toolbarTop }}
          >
            <span
              className="rotation-value"
              role="slider"
              tabIndex={0}
              aria-label="Molecule rotation"
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={displayedRotation}
              aria-valuetext={`${displayedRotation} degrees`}
              title="Rotation · use arrow keys or drag the rotation handle"
              onKeyDown={rotateWithKeyboard}
            >
              {displayedRotation}°
            </span>
            <span className="toolbar-divider" aria-hidden="true" />
            <button
              className="copy-button"
              type="button"
              title="Copy SMILES (⌘C / Ctrl+C)"
              aria-label="Copy SMILES"
              onClick={() => onCopy(molecule.canonicalSmiles)}
            >
              <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
                <rect x="7" y="3" width="9" height="11" rx="1.5" />
                <path d="M5 6H4.5A1.5 1.5 0 0 0 3 7.5v8A1.5 1.5 0 0 0 4.5 17h7A1.5 1.5 0 0 0 13 15.5V16" />
              </svg>
            </button>
            <button
              className={`flip-button${molecule.flippedHorizontally ? " is-active" : ""}`}
              type="button"
              title="Flip horizontally"
              aria-label="Flip molecule horizontally"
              aria-pressed={molecule.flippedHorizontally}
              onClick={() => onFlip(molecule.id, "horizontal")}
            >
              <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
                <path className="mirror-axis" d="M10 2v16" />
                <path d="m7.5 5-4 5 4 5V5Zm5 0 4 5-4 5V5Z" />
              </svg>
            </button>
            <button
              className={`flip-button${molecule.flippedVertically ? " is-active" : ""}`}
              type="button"
              title="Flip vertically"
              aria-label="Flip molecule vertically"
              aria-pressed={molecule.flippedVertically}
              onClick={() => onFlip(molecule.id, "vertical")}
            >
              <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
                <path className="mirror-axis" d="M2 10h16" />
                <path d="m5 7.5 5-4 5 4H5Zm0 5 5 4 5-4H5Z" />
              </svg>
            </button>
            <button
              className={`stereo-button${molecule.stereoLabels ? " is-active" : ""}`}
              type="button"
              title={`${molecule.stereoLabels ? "Hide" : "Show"} R/S and E/Z labels`}
              aria-label="Show stereochemistry labels"
              aria-pressed={molecule.stereoLabels}
              onClick={() => onToggleStereoLabels(molecule.id)}
            >
              R/S
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <button
              className="delete-button"
              type="button"
              title="Delete molecule"
              aria-label="Delete molecule"
              onClick={() => onRemove(molecule.id)}
            >
              ×
            </button>
          </div>

          <div
            className="smiles-label"
            title={`${molecule.canonicalSmiles} · ⌘C / Ctrl+C to copy`}
            style={{ top: labelTop }}
          >
            {molecule.canonicalSmiles}
          </div>
        </>
      )}
    </div>
  );
}

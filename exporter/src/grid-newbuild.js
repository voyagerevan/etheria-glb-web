// Voxelizer “new build” grid math (ported)
export const GRID_Y = 128;
const GRID_Z = 133;
const GRID_X = 1 + (GRID_Z - 1) * 0.75; // 100

function getNumberOfPillarsInclusiveNthRow(n) {
  return n + 1 + 3 * n * (n + 1) * 0.5;
}
function getNumberOfPillarsInNthRow(n) {
  return 1 + n * 3;
}
function calcPillarCount() {
  const corners = ((GRID_Z - 1) * 0.25 + 1) * (GRID_X + 1);
  const center = ((GRID_Z + 1) * 0.5 - 2 - 1) * (GRID_X - 0.5) + (GRID_X - 1);
  return corners + center;
}

export const PILLAR_COUNT = calcPillarCount();        // 9901
export const MAX_VOXEL_COUNT = PILLAR_COUNT * GRID_Y; // 1,267,328

const pillarIndex_center = (MAX_VOXEL_COUNT / GRID_Y - 1) / 2;
const pillarIndex_maxInc = 33 + 1 + 3 * ((33 * (33 + 1)) / 2);
const pillarIndex_minDec = PILLAR_COUNT - pillarIndex_maxInc;

export function discretePosFromGridIndex(gridIndex) {
  const y = gridIndex % GRID_Y;
  const pillarIndex = (gridIndex - y) / GRID_Y;

  let x, z;

  if (pillarIndex < pillarIndex_maxInc) {
    const zOffset = Math.ceil((1 / 6) * (Math.sqrt(24 * (pillarIndex + 1) + 1) - 5));
    const sumOfPreviousPillars = getNumberOfPillarsInclusiveNthRow(zOffset);
    x = pillarIndex - sumOfPreviousPillars + Math.ceil(getNumberOfPillarsInNthRow(zOffset) / 2);
    z = zOffset - 66;
  } else if (pillarIndex < pillarIndex_minDec) {
    const indexOffsetToCenter = pillarIndex - pillarIndex_center;
    x = Math.floor(indexOffsetToCenter - Math.round(indexOffsetToCenter / 99.5) * 99.5);
    z = Math.round((indexOffsetToCenter - x) / 99.5);
  } else {
    const zOffset = Math.ceil((1 / 6) * (Math.sqrt(24 * (PILLAR_COUNT - pillarIndex) + 1) - 5));
    const sumOfSubsequentPillars = getNumberOfPillarsInclusiveNthRow(zOffset);
    x = sumOfSubsequentPillars - Math.floor(getNumberOfPillarsInNthRow(zOffset) / 2) - (PILLAR_COUNT - pillarIndex);
    z = 66 - zOffset;
  }

  return { x, y, z };
}

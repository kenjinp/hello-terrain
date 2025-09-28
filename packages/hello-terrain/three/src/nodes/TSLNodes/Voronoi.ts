import {
  Fn,
  If,
  Loop,
  type ShaderNodeObject,
  float,
  mix,
  mx_noise_float,
  vec3,
} from 'three/tsl';
import type { ConstNode, Vector2, Vector3 } from 'three/webgpu';

const cellCenter = Fn(
  ({ cell }: { cell: ShaderNodeObject<ConstNode<Vector3>> }) => {
    return cell.add(mx_noise_float(cell.mul(Math.PI)));
  },
);

const voronoiCells = Fn(
  (params: {
    scale: number;
    facet: number;
    seed: number;
    uv: ShaderNodeObject<ConstNode<Vector2>>;
  }) => {
    const scale = float(params.scale);
    const facet = float(params.facet);
    const seed = float(params.seed);

    const pos = params.uv.mul(scale).add(seed);

    const midCell = pos.round().toVar();

    const minCell = midCell.toVar();
    const minDist = float(1).toVar();

    const cell = vec3(0, 0, 0).toVar();
    const dist = float().toVar();

    const i = float(0).toVar();

    Loop(27, () => {
      const ix = i.mod(3).sub(1);
      const iy = i.div(3).floor().mod(3).sub(1);
      const iz = i.div(9).floor().sub(1);
      cell.assign(midCell.add(vec3(ix, iy, iz)));
      dist.assign(
        pos.distance(cellCenter({ cell })).add(mx_noise_float(pos).div(5)),
      );

      If(dist.lessThan(minDist), () => {
        minDist.assign(dist);
        minCell.assign(cell);
      });
      i.addAssign(1);
    });

    const n = mx_noise_float(minCell.mul(Math.PI)).toVar();
    const k = mix(minDist, n.add(1).div(2), facet);

    // Generate distinct colors for each cell using hash
    // const hash = mx_noise_vec3(minCell.mul(123.456)).add(0.5);

    return k;
  },
);

export { voronoiCells };

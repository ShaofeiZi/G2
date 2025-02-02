import { get, isNil } from '@antv/util';
import { ShapeInfo } from '../../../interface';

/**
 * @ignore
 * 获取 Shape 的图形属性
 * @param cfg
 * @param isStroke 是否需要描边
 * @param isFill 是否需要填充
 * @param [sizeName] 可选，表示图形大小的属性，lineWidth 或者 r
 * @returns
 */
export function getStyle(cfg: ShapeInfo, isStroke: boolean, isFill: boolean, sizeName: string = '') {
  const { style, defaultStyle, color, size } = cfg;
  const attrs = {
    ...defaultStyle,
    ...style,
  };
  if (color) {
    if (isStroke) {
      if (!get(style, 'stroke')) {
        // 如果用户在 style() 中配置了 stroke，则以用户配置的为准
        attrs.stroke = color;
      }
    }

    if (isFill) {
      if (!get(style, 'fill')) {
        // 如果用户在 style() 中配置了 fill
        attrs.fill = color;
      }
    }
  }
  if (sizeName && isNil(get(style, sizeName)) && !isNil(size)) {
    // 如果用户在 style() 中配置了 lineWidth 或者 r 属性
    attrs[sizeName] = size;
  }

  return attrs;
}

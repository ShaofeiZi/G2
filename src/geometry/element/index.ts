import { deepMix, each, get, isArray, isEmpty, isFunction } from '@antv/util';
import { doAnimate, getDefaultAnimateCfg } from '../../animate';
import Base from '../../base';
import { BBox, IGroup, IShape } from '../../dependents';
import { AnimateOption, Datum, LooseObject, ShapeFactory, ShapeInfo, StateCfg } from '../../interface';
import { getReplaceAttrs } from '../../util/graphics';
import Geometry from '../base';

import { propagationDelegate } from '@antv/component/lib/util/event';

/** Element 构造函数传入参数类型 */
interface ElementCfg {
  /** 用于创建各种 shape 的工厂对象 */
  shapeFactory: ShapeFactory;
  /** 主题 */
  theme: LooseObject;
  /** shape 容器 */
  container: IGroup;
  /** 虚拟 group，用户可以不传入 */
  offscreenGroup?: IGroup;
  /** 是否可见 */
  visible?: boolean;
}

/**
 * Element 图形元素。
 * 定义：在 G2 中，我们会将数据通过图形语法映射成不同的图形，比如点图，数据集中的每条数据会对应一个点，柱状图每条数据对应一个柱子，线图则是一组数据对应一条折线，Element 即一条/一组数据对应的图形元素，它代表一条数据或者一个数据集，在图形层面，它可以是单个 Shape 也可以是多个 Shape，我们称之为图形元素。
 */
export default class Element extends Base {
  /** 用于创建各种 shape 的工厂对象 */
  public shapeFactory: ShapeFactory;
  /** 主题 */
  public theme: LooseObject;
  /** shape 容器 */
  public container: IGroup;
  /** 最后创建的图形对象 */
  public shape: IShape | IGroup;
  /** shape 的动画配置 */
  public animate: AnimateOption | boolean;

  // 非构造函数属性，需要外部赋值
  /** element 对应的 Geometry 实例 */
  public geometry: Geometry;
  /** 保存 shape 对应的 label */
  public labelShape: IGroup[];

  /** 绘制的 shape 类型 */
  private shapeType: string;

  /** shape 绘制需要的数据 */
  private model: ShapeInfo;
  /** 原始数据 */
  private data: Datum;
  // 存储当前开启的状态
  private states: string[] = [];
  // 虚拟 Group
  private offscreenGroup: IGroup;

  constructor(cfg: ElementCfg) {
    super(cfg);

    const { shapeFactory, theme, container, offscreenGroup, visible = true } = cfg;
    this.shapeFactory = shapeFactory;
    this.theme = theme;
    this.container = container;
    this.offscreenGroup = offscreenGroup;
    this.visible = visible;
  }

  /**
   * 绘制图形。
   * @param model 绘制数据。
   * @param isUpdate 可选，是否是更新发生后的绘制。
   */
  public draw(model: ShapeInfo, isUpdate: boolean = false) {
    this.model = model;
    this.data = model.data; // 存储原始数据
    this.shapeType = this.getShapeType(model);

    // 绘制图形
    this.drawShape(model, isUpdate);

    if (this.visible === false) {
      // 用户在初始化的时候声明 visible: false
      this.changeVisible(false);
    }
  }

  /**
   * 更新图形。
   * @param model 更新的绘制数据。
   */
  public update(model: ShapeInfo) {
    const { shapeFactory, shape } = this;
    if (!shape) {
      return;
    }

    // 更新数据
    this.model = model;
    this.data = model.data;
    this.shapeType = this.getShapeType(model);

    // step 1: 更新 shape 携带的信息
    this.setShapeInfo(shape, model);

    // step 2: 使用虚拟 Group 重新绘制 shape，然后更新当前 shape
    const offscreenGroup = this.getOffscreenGroup();
    const newShape = shapeFactory.drawShape(this.shapeType, model, offscreenGroup);
    newShape.set('data', this.data);
    newShape.set('origin', model);

    // step 3: 同步 shape 样式
    this.syncShapeStyle(shape, newShape, '', this.getAnimateCfg('update'));
  }

  /**
   * 销毁 element 实例。
   */
  public destroy() {
    const { shapeFactory, shape } = this;

    if (shape) {
      const animateCfg = this.getAnimateCfg('leave');
      if (animateCfg) {
        // 指定了动画配置则执行销毁动画
        doAnimate(shape, animateCfg, {
          coordinate: shapeFactory.coordinate,
          toAttrs: {
            ...shape.attr(),
          },
        });
      } else {
        // 否则直接销毁
        shape.remove(true);
      }
    }

    this.states = [];
    super.destroy();
  }

  /**
   * 显示或者隐藏 element。
   * @param visible 是否可见。
   */
  public changeVisible(visible: boolean) {
    super.changeVisible(visible);

    if (visible) {
      if (this.shape) {
        this.shape.show();
      }
      if (this.labelShape) {
        this.labelShape.forEach((label: IGroup) => {
          label.show();
        });
      }
    } else {
      if (this.shape) {
        this.shape.hide();
      }
      if (this.labelShape) {
        this.labelShape.forEach((label: IGroup) => {
          label.hide();
        });
      }
    }
  }

  /**
   * 设置 Element 的状态。
   *
   * 目前 Element 开放三种状态：
   * 1. active
   * 2. selected
   * 3. inactive
   *
   * 这三种状态相互独立，可以进行叠加。
   *
   * 这三种状态的样式可在 [[Theme]] 主题中或者通过 `geometry.state()` 接口进行配置。
   *
   * ```ts
   * // 激活 active 状态
   * setState('active', true);
   * ```
   *
   * @param stateName 状态名
   * @param stateStatus 是否开启状态
   */
  public setState(stateName: string, stateStatus: boolean) {
    const { states, shapeFactory, model, shape, shapeType } = this;

    const index = states.indexOf(stateName);
    if (stateStatus) {
      // 开启状态
      if (index > -1) {
        // 该状态已经开启，则返回
        return;
      }
      states.push(stateName);
      if (stateName === 'active' || stateName === 'selected') {
        shape.toFront();
      }
    } else {
      if (index === -1) {
        // 关闭状态，但是状态未设置过
        return;
      }
      states.splice(index, 1);
      if (stateName === 'active' || stateName === 'selected') {
        shape.toBack();
      }
    }

    // 使用虚拟 group 重新绘制 shape，然后对这个 shape 应用状态样式后，更新当前 shape。
    const offscreenShape = shapeFactory.drawShape(shapeType, model, this.getOffscreenGroup());
    if (states.length) {
      // 应用当前状态
      states.forEach((state) => {
        this.syncShapeStyle(shape, offscreenShape, state, null);
      });
    } else {
      // 如果没有状态，则需要恢复至原始状态
      this.syncShapeStyle(shape, offscreenShape, '', null);
    }

    offscreenShape.remove(true); // 销毁，减少内存占用

    const eventObject = {
      state: stateName,
      stateStatus,
      element: this,
      target: this.container,
    };
    this.container.emit('statechange', eventObject);
    propagationDelegate(this.container, 'statechange', eventObject);
  }

  /**
   * 清空状量态，恢复至初始状态。
   */
  public clearStates() {
    const states = this.states;

    each(states, (state) => {
      this.setState(state, false);
    });

    this.states = [];
  }

  /**
   * 查询当前 Element 上是否已设置 `stateName` 对应的状态。
   * @param stateName 状态名称。
   * @returns true 表示存在，false 表示不存在。
   */
  public hasState(stateName: string): boolean {
    return this.states.includes(stateName);
  }

  /**
   * 获取当前 Element 上所有的状态。
   * @returns 当前 Element 上所有的状态数组。
   */
  public getStates(): string[] {
    return this.states;
  }

  /**
   * 获取 Element 对应的原始数据。
   * @returns 原始数据。
   */
  public getData(): Datum {
    return this.data;
  }

  /**
   * 获取 Element 对应的图形绘制数据。
   * @returns 图形绘制数据。
   */
  public getModel(): ShapeInfo {
    return this.model;
  }

  /**
   * 返回 Element 元素整体的 bbox，包含文本及文本连线（有的话）。
   * @returns 整体包围盒。
   */
  public getBBox(): BBox {
    const { shape, labelShape } = this;
    let bbox = {
      x: 0,
      y: 0,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
    if (shape) {
      bbox = shape.getCanvasBBox();
    }
    if (labelShape) {
      labelShape.forEach((label: IGroup) => {
        const labelBBox = label.getCanvasBBox();
        bbox.x = Math.min(labelBBox.x, bbox.x);
        bbox.y = Math.min(labelBBox.y, bbox.y);
        bbox.minX = Math.min(labelBBox.minX, bbox.minX);
        bbox.minY = Math.min(labelBBox.minY, bbox.minY);
        bbox.maxX = Math.max(labelBBox.maxX, bbox.maxX);
        bbox.maxY = Math.max(labelBBox.maxY, bbox.maxY);
      });
    }

    bbox.width = bbox.maxX - bbox.minX;
    bbox.height = bbox.maxY - bbox.minY;

    return bbox;
  }

  // 从主题中获取对应状态量的样式
  private getStateStyle(stateName: string, shapeKey?: string): StateCfg {
    const shapeType = this.shapeType;
    // 用户通过 geometry.state() 接口定义了状态样式
    const stateOption = get(this.geometry.stateOption, stateName, {});
    const stateCfg = deepMix({}, get(this.theme, [shapeType, stateName], {}), stateOption);

    let shapeStyle = get(stateCfg.style, [shapeKey]) ?
      get(stateCfg.style, [shapeKey]) :
      stateCfg.style;

    if (isFunction(shapeStyle)) {
      shapeStyle = shapeStyle(this);
    }

    return {
      animate: stateCfg.animate,
      style: shapeStyle,
    };
  }

  // 获取动画配置
  private getAnimateCfg(animateType: string) {
    const animate = this.geometry.animateOption;
    const { geometryType, coordinate } = this.shapeFactory;
    const defaultCfg = getDefaultAnimateCfg(geometryType, coordinate, animateType);

    // 1. animate === false, 用户关闭动画
    // 2. 动画默认开启，用户没有对动画进行配置同时有没有内置的默认动画
    // 3. 用户关闭对应的动画  animate: { enter: false }
    if (
      !animate ||
      (animate === true && isEmpty(defaultCfg)) ||
      animate[animateType] === false ||
      animate[animateType] === null
    ) {
      return null;
    }

    return {
      ...defaultCfg,
      ...animate[animateType],
    };
  }

  // 绘制图形
  private drawShape(model: ShapeInfo, isUpdate: boolean = false) {
    const { shapeFactory, container, shapeType } = this;

    // 自定义 shape 有可能返回空 shape
    this.shape = shapeFactory.drawShape(shapeType, model, container);

    if (this.shape) {
      this.setShapeInfo(this.shape, model); // 存储绘图数据
      if (!this.shape.get('name')) {
        // TODO: 当用户设置了 name 后，为了保证 geometry:eventName 这样的事件能够正常触发，需要加一个 inheritName
        // 等 G 事件改造完成后加上
        this.shape.set('name', this.shapeFactory.geometryType);
      }
      this.shape.set('inheritNames', ['element']);
      // 执行入场动画
      const animateType = isUpdate ? 'enter' : 'appear';
      const animateCfg = this.getAnimateCfg(animateType);
      if (animateCfg) {
        doAnimate(this.shape, animateCfg, {
          coordinate: shapeFactory.coordinate,
          toAttrs: {
            ...this.shape.attr(),
          },
        });
      }
    }
  }

  // 获取虚拟 Group
  private getOffscreenGroup() {
    if (!this.offscreenGroup) {
      const GroupCtor = this.container.getGroupBase(); // 获取分组的构造函数
      this.offscreenGroup = new GroupCtor({});
    }

    return this.offscreenGroup;
  }

  // 设置 shape 上需要携带的信息
  private setShapeInfo(shape: IShape | IGroup, data: ShapeInfo) {
    shape.set('origin', data);
    shape.set('element', this); // 考虑是否可以使用 G 事件的 delegateObject
    if (shape.isGroup()) {
      const children = shape.get('children');
      children.forEach((child) => {
        this.setShapeInfo(child, data);
      });
    }
  }

  // 更新当前 shape 的样式
  private syncShapeStyle(
    sourceShape: IGroup | IShape,
    targetShape: IGroup | IShape,
    state: string = '',
    animateCfg,
    index: number = 0
  ) {
    if (sourceShape.isGroup()) {
      const children = sourceShape.get('children');
      const newChildren = targetShape.get('children');
      for (let i = 0; i < children.length; i++) {
        this.syncShapeStyle(children[i], newChildren[i], state, animateCfg, index + i);
      }
    } else {
      let stateAnimate;
      if (state) {
        const { animate, style } = this.getStateStyle(state, sourceShape.get('name') || index); // 如果用户没有设置 name，则默认根据索引值
        targetShape.attr(style);
        stateAnimate = animate;
      }
      const newAttrs = getReplaceAttrs(sourceShape as IShape, targetShape as IShape);

      if (animateCfg) {
        // 需要进行动画
        doAnimate(sourceShape, animateCfg, {
          coordinate: this.shapeFactory.coordinate,
          toAttrs: newAttrs,
          shapeModel: this.model,
        });
      } else if (stateAnimate === null) {
        // 用户关闭了 state 动画
        sourceShape.attr(newAttrs);
      } else if (this.geometry.animateOption) {
        sourceShape.stopAnimate();
        sourceShape.animate(newAttrs, {
          duration: 300,
        });
      } else {
        sourceShape.attr(newAttrs);
      }
    }
  }

  private getShapeType(model: ShapeInfo) {
    const shape = get(model, 'shape');
    return isArray(shape) ? shape[0] : shape;
  }
}

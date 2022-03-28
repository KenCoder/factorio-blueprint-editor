import { EventEmitter } from 'eventemitter3'
import util from '../common/util'
import { Entity } from '../core/Entity'

class Node {
  public readonly inbound: Set<Node> = new Set()
  public readonly outbound: Set<Node> = new Set()
  public readonly inputProducts: Set<string> = new Set()
  public fixedProducts: Set<string> = new Set()
  public products: IProducts;
  public desc = '';
}

enum Relative {
  FRONT, BACK, LEFT, RIGHT, FRONTRIGHT, FRONTLEFT
}

const RelativeOffsetsForDir0 = {
  [Relative.FRONT]: [0, -1],
  [Relative.BACK]: [0, 1],
  [Relative.LEFT]: [-1, 0],
  [Relative.RIGHT]: [1, 0],
  [Relative.FRONTRIGHT]: [1, -1],
  [Relative.FRONTLEFT]: [-1, -1]
}

// Some entities have 2 nodes (e.g., conveyor) - we use an array and these are the indices
const LEFT = 0
const RIGHT = 1

function rotateDirCw(direction: number, count: number): number {
  return (direction + count * 2 + 8) % 8
}

export interface IProducts {
  entityNumber: number,
  index: number, // For entities that have more than one product (e.g., belts). Always left to right
  items: Set<string>,
  position: IPoint | undefined,
  delta: IPoint | undefined,
}

export type EntityByPosition = (p: IPoint) => Entity | undefined

export class ProductsCalculator extends EventEmitter {
  private readonly entityByPosition: EntityByPosition

  private readonly entityNodes: Map<number, Node[]> = new Map() // left then right for belts, splitters
  private readonly changeHandlers: Map<number, () => void> = new Map()

  // These nodes need to have their products re-examined and propagated
  private readonly dirtyProducts: Set<Node> = new Set()

  public respondToChanges = true

  public constructor(entityByPosition: EntityByPosition) {
    super()
    this.entityByPosition = entityByPosition
  }

  public onCreateEntity(entity: Entity): void {
    // TODO: ignore walls, power poles, etc.
    const handler = () => this.onEntityChange(entity)
    this.changeHandlers.set(entity.entityNumber, handler)
    entity.on('direction', handler)
    entity.on('recipe', handler)
    handler()
  }

  public onRemoveEntity(entity: Entity): void {
    this.removeEntity(entity)
    const handler = () => this.changeHandlers.get(entity.entityNumber)
    entity.off('direction', handler)
    entity.off('recipe', handler)
  }


  private onEntityChange(changedEntity: Entity): void {
    // Check everything that might connect to us (up to 2 units away)
    const toCheckForNodeChanges: Set<Entity> = new Set()
    for (let x = changedEntity.position.x - changedEntity.size.x / 2 - 2; x <= changedEntity.position.x + changedEntity.size.x / 2 + 2; x += 1) {
      for (let y = changedEntity.position.y - changedEntity.size.y / 2 - 2; y <= changedEntity.position.y + changedEntity.size.y / 2 + 2; y += 1) {
        const entity = this.entityByPosition({ x, y })
        if (entity) {
          toCheckForNodeChanges.add(entity)
        }
      }
    }
    for (const entity of toCheckForNodeChanges) {
      if (entity.type === 'inserter') {
        const inserter = entity
        const inserterNode = this.ensureNodesForEntity(inserter, 1)[0]
        this.setFixedProduct(inserterNode, undefined)

        const tiles = inserter.name === 'long_handed_inserter' ? 2 : 1
        // Inserters "point" to the place where they pick stuff up
        const target = this.findRelative(inserter, Relative.BACK, tiles)
        if (target?.type === 'transport_belt') {
          const belt = target
          const beltNodes = this.ensureNodesForEntity(belt, 2, { x: -1 / 8, y: 1 / 8 }, { x: 0, y: 1 / 8 })
          let side = RIGHT
          if (belt.direction === rotateDirCw(inserter.direction, 1) ||
            belt.direction === rotateDirCw(inserter.direction, 2)) {
            side = LEFT
          }
          this.setOutputs(inserterNode, beltNodes[side])
        }

        const source = this.findRelative(inserter, Relative.FRONT, tiles)
        if (source?.type === 'assembling_machine') {
          const sourceNode = this.ensureNodesForEntity(source, 1)[0]
          this.setInputs(inserterNode, sourceNode)
        }
      } else if (entity.type === 'assembling_machine') {
        const sourceNode = this.ensureNodesForEntity(entity, 1)[0]
        this.setFixedProduct(sourceNode, entity.recipe)
      } else if (entity.type === 'transport_belt') {
        const belt = entity
        const nodes = this.ensureNodesForEntity(entity, 2, { x: -1 / 8, y: 1 / 8 }, { x: 0, y: 1 / 8 })
        nodes.forEach(n => this.setFixedProduct(n, undefined))
        const target = this.findRelative(belt, Relative.FRONT, 1)
        if (target?.type === 'transport_belt' && target.direction === belt.direction) {
          const targetNodes = this.ensureNodesForEntity(target, 2, { x: -1 / 8, y: 1 / 8 }, { x: 0, y: 1 / 8 })
          this.setOutputs(nodes[0], targetNodes[0])
          this.setOutputs(nodes[1], targetNodes[1])
        }
        // TODO - other belt orientations / targets
      }
    }
    this.updateChangedNodes()
  }

  private findRelative(relativeTo: Entity, location: Relative, tiles: number): Entity | undefined {
    const fromNorth = RelativeOffsetsForDir0[location].map(v => v * tiles)
    const rotated = util.rotatePointBasedOnDir(fromNorth, relativeTo.direction)
    rotated.x += relativeTo.position.x
    rotated.y += relativeTo.position.y
    return this.entityByPosition(rotated)
  }

  private setFixedProduct(node: Node, product: string): void {
    if (node.fixedProducts.size != 1 || !node.fixedProducts.has(product)) {
      node.fixedProducts = new Set()
      if (product) {
        node.fixedProducts.add(product)
      }
      this.dirtyProducts.add(node)
    }
  }

  private ensureNodesForEntity(entity: Entity, nodeCount: number, offset?: IPoint, delta?: IPoint): Node[] {
    let nodes = this.entityNodes.get(entity.entityNumber)
    if (nodes && nodes.length !== nodeCount) {
      this.removeEntity(entity)
      nodes = undefined
    }
    if (nodes === undefined) {
      nodes = Array<Node>(nodeCount)
      const rotated = offset && util.rotatePointBasedOnDir(offset, entity.direction)
      const position: IPoint = rotated && { x: entity.position.x + rotated.x, y: entity.position.y + rotated.y }
      for (let i = 0; i < nodeCount; i++) {
        nodes[i] = new Node()
        nodes[i].desc = `${entity.name}${nodeCount > 1 ? `-${i}` : ''}`
        nodes[i].products = {
          entityNumber: entity.entityNumber,
          index: i,
          items: new Set(),
          position,
          delta: delta && util.rotatePointBasedOnDir(delta, entity.direction),
        }
        this.dirtyProducts.add(nodes[i])
      }

      this.entityNodes.set(entity.entityNumber, nodes)
    }
    return nodes
  }

  private disconnect(source: Node, target: Node): void {
    if (source.outbound.has(target)) {
      target.inbound.delete(source)
      source.outbound.delete(target)
      this.dirtyProducts.add(target)
    }
  }

  private connect(source: Node, target: Node): void {
    if (!source.outbound.has(target)) {
      source.outbound.add(target)
      target.inbound.add(source)
      this.dirtyProducts.add(target)
    }
  }

  private setOutputs(source: Node, ...outputs: Node[]): void {
    source.outbound.forEach(n => {
      if (!outputs.includes(n)) this.disconnect(source, n)
    })
    outputs.forEach(n => this.connect(source, n))
  }

  private setInputs(target: Node, ...inputs: Node[]): void {
    target.inbound.forEach(n => {
      if (!inputs.includes(n)) this.disconnect(n, target)
    })
    inputs.forEach(n => this.connect(n, target))
  }

  private removeEntity(entity: Entity): void {
    const prior = this.entityNodes.get(entity.entityNumber)
    if (prior) {
      this.entityNodes.delete(entity.entityNumber)
      prior.forEach(node => {
        node.inbound.forEach(n => this.disconnect(n, node))
        node.outbound.forEach(n => this.disconnect(node, n))
        this.dirtyProducts.delete(node)
      })
    }
  }

  private nodeProducts(node: Node): Set<string> {
    // Doesn't yet handle loops! Also eventually this should be events not all at once
    if (this.dirtyProducts.has(node)) {
      this.dirtyProducts.delete(node)
      node.inputProducts.clear()
      node.inbound.forEach(n => this.nodeProducts(n).forEach(p => {
        node.inputProducts.add(p)
      }))
      node.products.items = node.fixedProducts.size > 0 ? node.fixedProducts : node.inputProducts
      this.emit('products', node.products)
    }

    return node.products.items
  }

  public updateChangedNodes(): void {
    if (this.respondToChanges) {
      const dirty = [...this.dirtyProducts]
      dirty.forEach(n => this.nodeProducts(n))
      console.log(this)
    }
  }

  // For testing
  public calculateProducts(): Map<number, Set<string>[]> {
    return new Map(
      [...this.entityNodes].map(([k, v]) => [k, v.map(n => this.nodeProducts(n))])
    )
  }
}

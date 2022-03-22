import * as PIXI from 'pixi.js'
import { Blueprint } from '../core/Blueprint'
import { Entity } from '../core/Entity'

class Node {
    public readonly number;
    public readonly inbound: Set<Node> = new Set()
    public readonly outbound: Set<Node> = new Set()

    public constructor(number) {
        this.number = number
    }
}

type BeltProducts =
    public constructor(left: Node, right: Node) {
        this.left = left;
        this.right = right;
    }
    public readonly left: Node
    public readonly right: Node
}

export class ProductsContainer extends PIXI.Container {
    private readonly bp: Blueprint
    private readonly nodes: Map<number, Node> = new Map()
    private readonly dirty: Set<number> = new Set()

    public constructor(bp: Blueprint) {
        super()
        this.bp = bp
        this.bp.on('create-entity', this.onCreateEntity)
        this.bp.on('remove-entity', this.onRemoveEntity)
    }

    private onCreateEntity(entity: Entity): void {
        // ignore walls, power poles, etc.
        entity.on('direction', this.onEntityChange)
    }

    private removeEntity(entity: Entity): void {
        const prior = this.nodes.get(entity.entityNumber)
        if (prior) {
            this.nodes.delete(entity.entityNumber)
            prior.inbound.forEach(n => this.dirty.add(n.number))
            prior.outbound.forEach(n => this.dirty.add(n.number))
        }

    }
    private onEntityChange(entity: Entity): void {
        this.removeEntity(entity)
        this.nodes.set(entity.entityNumber, new Node(entity.entityNumber))
        this.dirty.add(entity.entityNumber)
    }

    private onRemoveEntity(entity: Entity): void {
        this.removeEntity(entity)
        entity.off('direction', this.onEntityChange)
    }

    private calculate(): void {

    }
}

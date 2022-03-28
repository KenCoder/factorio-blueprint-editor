import * as PIXI from 'pixi.js'
import F from '../UI/controls/functions'
import { Blueprint } from '../core/Blueprint'
import { IProducts, ProductsCalculator } from './ProductsCalculator'

export class ProductsContainer extends PIXI.Container {
    private readonly bp: Blueprint

    private readonly calculator: ProductsCalculator

    private readonly icons: Map<string, PIXI.DisplayObject[]>

    public constructor(bp: Blueprint) {
        super()
        this.bp = bp
        this.icons = new Map()
        this.calculator = new ProductsCalculator(
            pt => bp.entityPositionGrid.getEntityAtPosition(pt.x, pt.y))

        for (const [, e] of this.bp.entities) {
            this.calculator.onCreateEntity(e)
        }
        this.calculator.on('products', this.onProductChange)

        this.bp.on('create-entity', this.calculator.onCreateEntity)
        this.bp.on('remove-entity', this.calculator.onRemoveEntity)
    }

    private onProductChange(change: IProducts): void {
        const key = `${change.entityNumber}`
        if (this.icons.has(key)) {
            this.icons.get(key).map(e => e.destroy())
            this.icons.delete(key)
        }
        if (change.items.size > 0 && change.offset !== undefined) {
            const sortedItems = [...change.items].sort()
            this.icons.set(key, sortedItems.map((name, idx) => {
                const icon = F.CreateIcon(name, 16)
                icon.position.set(change.offset.x + idx * change.delta.x, change.offset.y + idx * change.delta.y)
                this.addChild(icon)
                return icon
            }))
        }
    }
}
